from arcadepy import AsyncArcade
from dotenv import load_dotenv
from google.adk import Agent, Runner
from google.adk.artifacts import InMemoryArtifactService
from google.adk.models.lite_llm import LiteLlm
from google.adk.sessions import InMemorySessionService, Session
from google_adk_arcade.tools import get_arcade_tools
from google.genai import types
from human_in_the_loop import auth_tool, confirm_tool_usage

import os

load_dotenv(override=True)


async def main():
    app_name = "my_agent"
    user_id = os.getenv("ARCADE_USER_ID")

    session_service = InMemorySessionService()
    artifact_service = InMemoryArtifactService()
    client = AsyncArcade()

    agent_tools = await get_arcade_tools(
        client, toolkits=["Zendesk"]
    )

    for tool in agent_tools:
        await auth_tool(client, tool_name=tool.name, user_id=user_id)

    agent = Agent(
        model=LiteLlm(model=f"openai/{os.environ["OPENAI_MODEL"]}"),
        name="google_agent",
        instruction="# Introduction
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
        description="An agent that uses Zendesk tools provided to perform any task",
        tools=agent_tools,
        before_tool_callback=[confirm_tool_usage],
    )

    session = await session_service.create_session(
        app_name=app_name, user_id=user_id, state={
            "user_id": user_id,
        }
    )
    runner = Runner(
        app_name=app_name,
        agent=agent,
        artifact_service=artifact_service,
        session_service=session_service,
    )

    async def run_prompt(session: Session, new_message: str):
        content = types.Content(
            role='user', parts=[types.Part.from_text(text=new_message)]
        )
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=content,
        ):
            if event.content.parts and event.content.parts[0].text:
                print(f'** {event.author}: {event.content.parts[0].text}')

    while True:
        user_input = input("User: ")
        if user_input.lower() == "exit":
            print("Goodbye!")
            break
        await run_prompt(session, user_input)


if __name__ == '__main__':
    import asyncio
    asyncio.run(main())