from agents import (Agent, Runner, AgentHooks, Tool, RunContextWrapper,
                    TResponseInputItem,)
from functools import partial
from arcadepy import AsyncArcade
from agents_arcade import get_arcade_tools
from typing import Any
from human_in_the_loop import (UserDeniedToolCall,
                               confirm_tool_usage,
                               auth_tool)

import globals


class CustomAgentHooks(AgentHooks):
    def __init__(self, display_name: str):
        self.event_counter = 0
        self.display_name = display_name

    async def on_start(self,
                       context: RunContextWrapper,
                       agent: Agent) -> None:
        self.event_counter += 1
        print(f"### ({self.display_name}) {
              self.event_counter}: Agent {agent.name} started")

    async def on_end(self,
                     context: RunContextWrapper,
                     agent: Agent,
                     output: Any) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                # agent.name} ended with output {output}"
                agent.name} ended"
        )

    async def on_handoff(self,
                         context: RunContextWrapper,
                         agent: Agent,
                         source: Agent) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                source.name} handed off to {agent.name}"
        )

    async def on_tool_start(self,
                            context: RunContextWrapper,
                            agent: Agent,
                            tool: Tool) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}:"
            f" Agent {agent.name} started tool {tool.name}"
            f" with context: {context.context}"
        )

    async def on_tool_end(self,
                          context: RunContextWrapper,
                          agent: Agent,
                          tool: Tool,
                          result: str) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                # agent.name} ended tool {tool.name} with result {result}"
                agent.name} ended tool {tool.name}"
        )


async def main():

    context = {
        "user_id": os.getenv("ARCADE_USER_ID"),
    }

    client = AsyncArcade()

    arcade_tools = await get_arcade_tools(
        client, toolkits=["Zendesk"]
    )

    for tool in arcade_tools:
        # - human in the loop
        if tool.name in ENFORCE_HUMAN_CONFIRMATION:
            tool.on_invoke_tool = partial(
                confirm_tool_usage,
                tool_name=tool.name,
                callback=tool.on_invoke_tool,
            )
        # - auth
        await auth_tool(client, tool.name, user_id=context["user_id"])

    agent = Agent(
        name="",
        instructions="# Introduction
Welcome to the Zendesk AI Agent! This intelligent agent is designed to assist users with managing support tickets, adding comments, searching knowledge articles, and retrieving user information within their Zendesk account. Leveraging advanced tools, the agent aims to streamline ticket management and enhance customer support efficiency.

# Instructions
1. Understand user queries regarding Zendesk ticket management, article searches, and user profile details.
2. Utilize the appropriate Zendesk tools based on user requests to fetch or post information.
3. Ensure to provide clear, informative responses, including direct links to tickets or articles where applicable.
4. Follow a ReAct approach, which allows for real-time interaction and iterative responses, refining the approach based on user feedback.

# Workflows

## 1. Ticket Management Workflow
- **Goal**: Manage tickets through listing, commenting, and marking as solved.
  1. **Zendesk_ListTickets**: Retrieve a list of open tickets.
  2. **Zendesk_GetTicketComments**: If a user requests to see or discuss a specific ticket, get all comments for that ticket.
  3. **Zendesk_AddTicketComment**: Allow the user to add a comment to an existing ticket.
  4. **Zendesk_MarkTicketSolved**: Optionally mark the ticket as solved with a final comment.

## 2. Search Knowledge Base Articles Workflow
- **Goal**: Assist users in locating help articles from the Zendesk knowledge base.
  1. **Zendesk_SearchArticles**: Conduct searches using the user-provided query or labels to find relevant articles.
  2. Provide a summary of the articles found along with links for easy access.

## 3. User Profile Information Workflow
- **Goal**: Retrieve and provide user and account information.
  1. **Zendesk_WhoAmI**: Obtain comprehensive user profile information including name, email, and role.
  2. Present the user details in a clear format for easy understanding.

## 4. Comment Retrieval Workflow
- **Goal**: Fetch comments from a specific ticket.
  1. **Zendesk_GetTicketComments**: Retrieve comments for a specified ticket based on user input.
  2. Provide a clear and organized view of the conversation history. 

By following these workflows, the agent will be able to effectively handle user inquiries related to Zendesk operations while providing a seamless user experience.",
        model=os.environ["OPENAI_MODEL"],
        tools=arcade_tools,
        hooks=CustomAgentHooks(display_name="")
    )

    # initialize the conversation
    history: list[TResponseInputItem] = []
    # run the loop!
    while True:
        prompt = input("You: ")
        if prompt.lower() == "exit":
            break
        history.append({"role": "user", "content": prompt})
        try:
            result = await Runner.run(
                starting_agent=agent,
                input=history,
                context=context
            )
            history = result.to_input_list()
            print(result.final_output)
        except UserDeniedToolCall as e:
            history.extend([
                {"role": "assistant",
                 "content": f"Please confirm the call to {e.tool_name}"},
                {"role": "user",
                 "content": "I changed my mind, please don't do it!"},
                {"role": "assistant",
                 "content": f"Sure, I cancelled the call to {e.tool_name}."
                 " What else can I do for you today?"
                 },
            ])
            print(history[-1]["content"])

if __name__ == "__main__":
    import asyncio

    asyncio.run(main())