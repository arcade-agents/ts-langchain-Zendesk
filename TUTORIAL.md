---
title: "Build a Zendesk agent with LangChain (TypeScript) and Arcade"
slug: "ts-langchain-Zendesk"
framework: "langchain-ts"
language: "typescript"
toolkits: ["Zendesk"]
tools: []
difficulty: "beginner"
generated_at: "2026-03-12T01:34:19Z"
source_template: "ts_langchain"
agent_repo: ""
tags:
  - "langchain"
  - "typescript"
  - "zendesk"
---

# Build a Zendesk agent with LangChain (TypeScript) and Arcade

In this tutorial you'll build an AI agent using [LangChain](https://js.langchain.com/) with [LangGraph](https://langchain-ai.github.io/langgraphjs/) in TypeScript and [Arcade](https://arcade.dev) that can interact with Zendesk tools — with built-in authorization and human-in-the-loop support.

## Prerequisites

- The [Bun](https://bun.com) runtime
- An [Arcade](https://arcade.dev) account and API key
- An OpenAI API key

## Project Setup

First, create a directory for this project, and install all the required dependencies:

````bash
mkdir zendesk-agent && cd zendesk-agent
bun install @arcadeai/arcadejs @langchain/langgraph @langchain/core langchain chalk
````

## Start the agent script

Create a `main.ts` script, and import all the packages and libraries. Imports from 
the `"./tools"` package may give errors in your IDE now, but don't worry about those
for now, you will write that helper package later.

````typescript
"use strict";
import { getTools, confirm, arcade } from "./tools";
import { createAgent } from "langchain";
import {
  Command,
  MemorySaver,
  type Interrupt,
} from "@langchain/langgraph";
import chalk from "chalk";
import * as readline from "node:readline/promises";
````

## Configuration

In `main.ts`, configure your agent's toolkits, system prompt, and model. Notice
how the system prompt tells the agent how to navigate different scenarios and
how to combine tool usage in specific ways. This prompt engineering is important
to build effective agents. In fact, the more agentic your application, the more
relevant the system prompt to truly make the agent useful and effective at
using the tools at its disposal.

````typescript
// configure your own values to customize your agent

// The Arcade User ID identifies who is authorizing each service.
const arcadeUserID = process.env.ARCADE_USER_ID;
if (!arcadeUserID) {
  throw new Error("Missing ARCADE_USER_ID. Add it to your .env file.");
}
// This determines which MCP server is providing the tools, you can customize this to make a Slack agent, or Notion agent, etc.
// all tools from each of these MCP servers will be retrieved from arcade
const toolkits=['Zendesk'];
// This determines isolated tools that will be
const isolatedTools=[];
// This determines the maximum number of tool definitions Arcade will return
const toolLimit = 100;
// This prompt defines the behavior of the agent.
const systemPrompt = "# Agent Prompt for ReAct Zendesk Helper\n\n## Introduction\nYou are a ReAct-style AI agent that helps support agents interact with Zendesk using a small set of tools. Your purpose is to read ticket context, search the knowledge base, add public or internal ticket comments, list tickets, and mark tickets solved. Use the provided tools to gather evidence, decide actions, and perform the requested Zendesk operations.\n\nFollow the ReAct loop: think (brief reasoning), act (call a tool with parameters), observe (read tool output), then repeat until you can produce a final, correct reply or perform the final action on the ticket.\n\n---\n\n## Instructions\n- Always follow the Thought -\u003e Action -\u003e Observation -\u003e (repeat) -\u003e Final Answer pattern.\n  - Thought: concise reasoning about what you will do and why.\n  - Action: call exactly one tool with correctly formatted parameters.\n  - Observation: include the raw/parsed output returned by the tool (you will receive this automatically).\n  - Final Answer: when finished, present a concise summary of what you did or what you recommend next.\n- Only call a tool when you need information or need to make a change. Do not call tools redundantly.\n- If user intent is ambiguous or missing required values (e.g., ticket_id), ask a clarifying question before calling any tool.\n- For Zendesk_SearchArticles: combine all required search filters into a single call (do not call the search tool multiple times with separate filters).\n- When paginated results appear (responses include next_offset), handle pagination explicitly \u2014 fetch more only if necessary and if the user asked for more results. Mention pagination in the Thought step when you plan to fetch more.\n- Respect public vs. internal comments:\n  - Use public = true for replies intended for the ticket requester.\n  - Use public = false for internal notes (investigations, private agent comments).\n- When posting or marking solved, include a clear, polite message body in comment_body. If marking solved with a comment, note that comment_public defaults to false unless explicitly set.\n- After any tool that returns a ticket object, include the html_url in your final answer so the human agent can open it.\n- Be concise and actionable. Provide recommended next steps or follow-up questions when appropriate.\n\n---\n\n## Tool Use Rules \u0026 Parameter Notes\n- Zendesk_AddTicketComment\n  - Required: ticket_id (integer), comment_body (string)\n  - Optional: public (boolean, defaults to true)\n  - Use for both public replies and internal notes. Set public=false for internal.\n- Zendesk_GetTicketComments\n  - Required: ticket_id (integer)\n  - The first returned comment is the original ticket description.\n- Zendesk_ListTickets\n  - Optional: status (defaults to \"open\"), limit (defaults to 30), offset (defaults to 0), sort_order (\"asc\" or \"desc\", defaults to \"desc\")\n  - Response may include next_offset. Use offset to fetch subsequent pages.\n- Zendesk_MarkTicketSolved\n  - Required: ticket_id (integer)\n  - Optional: comment_body (string), comment_public (boolean, defaults to false)\n  - Use to close tickets and optionally add a final comment. If you want the requester to see the final comment, set comment_public=true.\n- Zendesk_SearchArticles\n  - At least one of: query or label_names must be provided.\n  - Combine filters into one call. Optional: created_after, created_before, created_at, sort_by, sort_order, limit, offset, include_body, max_article_length.\n  - Bodies returned when include_body=true will be cleaned and truncated according to max_article_length.\n- Zendesk_WhoAmI\n  - No parameters. Use to get agent/account context (useful before posting internal notes or signing messages).\n\n---\n\n## Workflows\nBelow are common workflows and the recommended sequence of tool calls. For each step include a brief Thought explaining the reason.\n\n1) Read ticket history and respond publicly with a knowledge base article\n- Use sequence:\n  1. Zendesk_GetTicketComments(ticket_id=...)\n     - Thought: \"I need the ticket history to understand the problem and avoid repeating info.\"\n  2. Zendesk_SearchArticles(query=\"...\", include_body=true, max_article_length=500)\n     - Thought: \"Search KB for relevant guidance to answer the user with authoritative steps.\"\n  3. Zendesk_AddTicketComment(ticket_id=..., comment_body=\"... summary + KB link/excerpt ...\", public=true)\n     - Thought: \"Post a concise public reply citing the KB and next steps.\"\n  4. (Optional) Zendesk_MarkTicketSolved(ticket_id=..., comment_body=\"Optional final note\", comment_public=true/false)\n     - Thought: \"Close ticket if appropriate.\"\n\nExample:\n```\nThought: Get ticket history to understand the ask.\nAction: Zendesk_GetTicketComments(ticket_id=12345)\n\nObservation: [comments returned]\n\nThought: Search KB for a step-by-step guide matching the user\u0027s error message.\nAction: Zendesk_SearchArticles(query=\"How to fix X error\", include_body=true, max_article_length=1000, limit=5)\n\nObservation: [articles returned]\n\nThought: Post a public reply summarizing recommended steps and link to article.\nAction: Zendesk_AddTicketComment(ticket_id=12345, comment_body=\"Hi \u2014 please try... See this article: \u003curl\u003e \u2014 let me know if it works.\", public=true)\n\nObservation: [ticket object returned with html_url]\n\nFinal Answer: Posted public reply and linked article: \u003chtml_url\u003e\n```\n\n2) Add an internal investigation note\n- Use sequence:\n  1. Zendesk_WhoAmI() \u2014 optional, to sign or confirm agent identity.\n  2. Zendesk_GetTicketComments(ticket_id=...) \u2014 to confirm context.\n  3. Zendesk_AddTicketComment(ticket_id=..., comment_body=\"Internal note: ...\", public=false)\n- Use internal notes for debugging information, triage decisions, or handoffs.\n\n3) Mark a ticket solved with a final public or internal message\n- Use sequence:\n  1. (Optional) Zendesk_GetTicketComments(ticket_id=...) \u2014 to ensure resolution addresses last request.\n  2. Zendesk_MarkTicketSolved(ticket_id=..., comment_body=\"Final message\", comment_public=true/false)\n- Note: comment_public defaults false. Set comment_public=true if you want the requester to see the closing message.\n\n4) Find relevant knowledge base articles (search)\n- Use sequence:\n  1. Zendesk_SearchArticles(query=\"...\", label_names=[...], created_after=\"YYYY-MM-DD\", include_body=true, limit=10)\n     - Thought: \"Combine all filters in one call to get the most relevant matches and possibly bodies.\"\n\nPagination: if you receive next_offset and the user asked for more results, call Zendesk_SearchArticles again with offset=next_offset.\n\n5) List tickets (e.g., open tickets for triage)\n- Use sequence:\n  1. Zendesk_ListTickets(status=\"open\", limit=30, offset=0, sort_order=\"desc\")\n     - Thought: \"List newest open tickets. If user asks for older tickets, fetch next_offset.\"\n  2. For any ticket to inspect, run Zendesk_GetTicketComments(ticket_id=...)\n  3. Add comments or mark solved as needed using Zendesk_AddTicketComment or Zendesk_MarkTicketSolved.\n\n---\n\n## Output \u0026 Communication Format\n- Use the following structure when interacting (ReAct style):\n  - Thought: Short note about reasoning or next step.\n  - Action: \u003cToolName\u003e(param1=..., param2=...)\n  - Observation: [tool output will appear here]\n  - (Repeat Thought/Action/Observation until ready)\n  - Final Answer: short summary of actions taken, include html_url for any ticket returned, and recommended next steps or a clarifying question.\n\nExample final answer:\n```\nFinal Answer:\n- I posted a public reply to ticket #12345 with steps and linked KB article.\n- Ticket link: https://.../tickets/12345\n- Suggested next step: If user still sees the error, ask for a screenshot and logs.\n```\n\n---\n\n## Edge Cases \u0026 Best Practices\n- If the user asks to \"reply to ticket #...\" but no ticket_id provided, ask for ticket_id before any tool calls.\n- If the user requests a KB search by label and your plan does not support labels, inform them and ask to use a query instead.\n- When citing KB articles in replies, include the article title and URL. If include_body was used, include a short excerpt and note that the body was truncated if applicable.\n- Avoid posting overly technical or internal logs in public comments \u2014 use internal notes for that.\n- If a tool returns an error or empty result, reflect that in Observation and either ask the user for clarification or try a different approach.\n\n---\n\nUse this prompt as the agent\u0027s instruction set and format guide. Follow the ReAct pattern strictly and only call tools when needed, returning clear, concise final answers with links to Zendesk tickets when applicable.";
// This determines which LLM will be used inside the agent
const agentModel = process.env.OPENAI_MODEL;
if (!agentModel) {
  throw new Error("Missing OPENAI_MODEL. Add it to your .env file.");
}
// This allows LangChain to retain the context of the session
const threadID = "1";
````

Set the following environment variables in a `.env` file:

````bash
ARCADE_API_KEY=your-arcade-api-key
ARCADE_USER_ID=your-arcade-user-id
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5-mini
````

## Implementing the `tools.ts` module

The `tools.ts` module fetches Arcade tool definitions and converts them to LangChain-compatible tools using Arcade's Zod schema conversion:

### Create the file and import the dependencies

Create a `tools.ts` file, and add import the following. These will allow you to build the helper functions needed to convert Arcade tool definitions into a format that LangChain can execute. Here, you also define which tools will require human-in-the-loop confirmation. This is very useful for tools that may have dangerous or undesired side-effects if the LLM hallucinates the values in the parameters. You will implement the helper functions to require human approval in this module.

````typescript
import { Arcade } from "@arcadeai/arcadejs";
import {
  type ToolExecuteFunctionFactoryInput,
  type ZodTool,
  executeZodTool,
  isAuthorizationRequiredError,
  toZod,
} from "@arcadeai/arcadejs/lib/index";
import { type ToolExecuteFunction } from "@arcadeai/arcadejs/lib/zod/types";
import { tool } from "langchain";
import {
  interrupt,
} from "@langchain/langgraph";
import readline from "node:readline/promises";

// This determines which tools require human in the loop approval to run
const TOOLS_WITH_APPROVAL = ['Zendesk_AddTicketComment', 'Zendesk_MarkTicketSolved'];
````

### Create a confirmation helper for human in the loop

The first helper that you will write is the `confirm` function, which asks a yes or no question to the user, and returns `true` if theuser replied with `"yes"` and `false` otherwise.

````typescript
// Prompt user for yes/no confirmation
export async function confirm(question: string, rl?: readline.Interface): Promise<boolean> {
  let shouldClose = false;
  let interface_ = rl;

  if (!interface_) {
      interface_ = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
      });
      shouldClose = true;
  }

  const answer = await interface_.question(`${question} (y/n): `);

  if (shouldClose) {
      interface_.close();
  }

  return ["y", "yes"].includes(answer.trim().toLowerCase());
}
````

Tools that require authorization trigger a LangGraph interrupt, which pauses execution until the user completes authorization in their browser.

### Create the execution helper

This is a wrapper around the `executeZodTool` function. Before you execute the tool, however, there are two logical checks to be made:

1. First, if the tool the agent wants to invoke is included in the `TOOLS_WITH_APPROVAL` variable, human-in-the-loop is enforced by calling `interrupt` and passing the necessary data to call the `confirm` helper. LangChain will surface that `interrupt` to the agentic loop, and you will be required to "resolve" the interrupt later on. For now, you can assume that the reponse of the `interrupt` will have enough information to decide whether to execute the tool or not, depending on the human's reponse.
2. Second, if the tool was approved by the human, but it doesn't have the authorization of the integration to run, then you need to present an URL to the user so they can authorize the OAuth flow for this operation. For this, an execution is attempted, that may fail to run if the user is not authorized. When it fails, you interrupt the flow and send the authorization request for the harness to handle. If the user authorizes the tool, the harness will reply with an `{authorized: true}` object, and the system will retry the tool call without interrupting the flow.

````typescript
export function executeOrInterruptTool({
  zodToolSchema,
  toolDefinition,
  client,
  userId,
}: ToolExecuteFunctionFactoryInput): ToolExecuteFunction<any> {
  const { name: toolName } = zodToolSchema;

  return async (input: unknown) => {
    try {

      // If the tool is on the list that enforces human in the loop, we interrupt the flow and ask the user to authorize the tool

      if (TOOLS_WITH_APPROVAL.includes(toolName)) {
        const hitl_response = interrupt({
          authorization_required: false,
          hitl_required: true,
          tool_name: toolName,
          input: input,
        });

        if (!hitl_response.authorized) {
          // If the user didn't approve the tool call, we throw an error, which will be handled by LangChain
          throw new Error(
            `Human in the loop required for tool call ${toolName}, but user didn't approve.`
          );
        }
      }

      // Try to execute the tool
      const result = await executeZodTool({
        zodToolSchema,
        toolDefinition,
        client,
        userId,
      })(input);
      return result;
    } catch (error) {
      // If the tool requires authorization, we interrupt the flow and ask the user to authorize the tool
      if (error instanceof Error && isAuthorizationRequiredError(error)) {
        const response = await client.tools.authorize({
          tool_name: toolName,
          user_id: userId,
        });

        // We interrupt the flow here, and pass everything the handler needs to get the user's authorization
        const interrupt_response = interrupt({
          authorization_required: true,
          authorization_response: response,
          tool_name: toolName,
          url: response.url ?? "",
        });

        // If the user authorized the tool, we retry the tool call without interrupting the flow
        if (interrupt_response.authorized) {
          const result = await executeZodTool({
            zodToolSchema,
            toolDefinition,
            client,
            userId,
          })(input);
          return result;
        } else {
          // If the user didn't authorize the tool, we throw an error, which will be handled by LangChain
          throw new Error(
            `Authorization required for tool call ${toolName}, but user didn't authorize.`
          );
        }
      }
      throw error;
    }
  };
}
````

### Create the tool retrieval helper

The last helper function of this module is the `getTools` helper. This function will take the configurations you defined in the `main.ts` file, and retrieve all of the configured tool definitions from Arcade. Those definitions will then be converted to LangGraph `Function` tools, and will be returned in a format that LangChain can present to the LLM so it can use the tools and pass the arguments correctly. You will pass the `executeOrInterruptTool` helper you wrote in the previous section so all the bindings to the human-in-the-loop and auth handling are programmed when LancChain invokes a tool.


````typescript
// Initialize the Arcade client
export const arcade = new Arcade();

export type GetToolsProps = {
  arcade: Arcade;
  toolkits?: string[];
  tools?: string[];
  userId: string;
  limit?: number;
}


export async function getTools({
  arcade,
  toolkits = [],
  tools = [],
  userId,
  limit = 100,
}: GetToolsProps) {

  if (toolkits.length === 0 && tools.length === 0) {
      throw new Error("At least one tool or toolkit must be provided");
  }

  // Todo(Mateo): Add pagination support
  const from_toolkits = await Promise.all(toolkits.map(async (tkitName) => {
      const definitions = await arcade.tools.list({
          toolkit: tkitName,
          limit: limit
      });
      return definitions.items;
  }));

  const from_tools = await Promise.all(tools.map(async (toolName) => {
      return await arcade.tools.get(toolName);
  }));

  const all_tools = [...from_toolkits.flat(), ...from_tools];
  const unique_tools = Array.from(
      new Map(all_tools.map(tool => [tool.qualified_name, tool])).values()
  );

  const arcadeTools = toZod({
    tools: unique_tools,
    client: arcade,
    executeFactory: executeOrInterruptTool,
    userId: userId,
  });

  // Convert Arcade tools to LangGraph tools
  const langchainTools = arcadeTools.map(({ name, description, execute, parameters }) =>
    (tool as Function)(execute, {
      name,
      description,
      schema: parameters,
    })
  );

  return langchainTools;
}
````

## Building the Agent

Back on the `main.ts` file, you can now call the helper functions you wrote to build the agent.

### Retrieve the configured tools

Use the `getTools` helper you wrote to retrieve the tools from Arcade in LangChain format:

````typescript
const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});
````

### Write an interrupt handler

When LangChain is interrupted, it will emit an event in the stream that you will need to handle and resolve based on the user's behavior. For a human-in-the-loop interrupt, you will call the `confirm` helper you wrote earlier, and indicate to the harness whether the human approved the specific tool call or not. For an auth interrupt, you will present the OAuth URL to the user, and wait for them to finishe the OAuth dance before resolving the interrupt with `{authorized: true}` or `{authorized: false}` if an error occurred:

````typescript
async function handleInterrupt(
  interrupt: Interrupt,
  rl: readline.Interface
): Promise<{ authorized: boolean }> {
  const value = interrupt.value;
  const authorization_required = value.authorization_required;
  const hitl_required = value.hitl_required;
  if (authorization_required) {
    const tool_name = value.tool_name;
    const authorization_response = value.authorization_response;
    console.log("⚙️: Authorization required for tool call", tool_name);
    console.log(
      "⚙️: Please authorize in your browser",
      authorization_response.url
    );
    console.log("⚙️: Waiting for you to complete authorization...");
    try {
      await arcade.auth.waitForCompletion(authorization_response.id);
      console.log("⚙️: Authorization granted. Resuming execution...");
      return { authorized: true };
    } catch (error) {
      console.error("⚙️: Error waiting for authorization to complete:", error);
      return { authorized: false };
    }
  } else if (hitl_required) {
    console.log("⚙️: Human in the loop required for tool call", value.tool_name);
    console.log("⚙️: Please approve the tool call", value.input);
    const approved = await confirm("Do you approve this tool call?", rl);
    return { authorized: approved };
  }
  return { authorized: false };
}
````

### Create an Agent instance

Here you create the agent using the `createAgent` function. You pass the system prompt, the model, the tools, and the checkpointer. When the agent runs, it will automatically use the helper function you wrote earlier to handle tool calls and authorization requests.

````typescript
const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});
````

### Write the invoke helper

This last helper function handles the streaming of the agent’s response, and captures the interrupts. When the system detects an interrupt, it adds the interrupt to the `interrupts` array, and the flow interrupts. If there are no interrupts, it will just stream the agent’s to your console.

````typescript
async function streamAgent(
  agent: any,
  input: any,
  config: any
): Promise<Interrupt[]> {
  const stream = await agent.stream(input, {
    ...config,
    streamMode: "updates",
  });
  const interrupts: Interrupt[] = [];

  for await (const chunk of stream) {
    if (chunk.__interrupt__) {
      interrupts.push(...(chunk.__interrupt__ as Interrupt[]));
      continue;
    }
    for (const update of Object.values(chunk)) {
      for (const msg of (update as any)?.messages ?? []) {
        console.log("🤖: ", msg.toFormattedString());
      }
    }
  }

  return interrupts;
}
````

### Write the main function

Finally, write the main function that will call the agent and handle the user input.

Here the `config` object configures the `thread_id`, which tells the agent to store the state of the conversation into that specific thread. Like any typical agent loop, you:

1. Capture the user input
2. Stream the agent's response
3. Handle any authorization interrupts
4. Resume the agent after authorization
5. Handle any errors
6. Exit the loop if the user wants to quit

````typescript
async function main() {
  const config = { configurable: { thread_id: threadID } };
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.green("Welcome to the chatbot! Type 'exit' to quit."));
  while (true) {
    const input = await rl.question("> ");
    if (input.toLowerCase() === "exit") {
      break;
    }
    rl.pause();

    try {
      let agentInput: any = {
        messages: [{ role: "user", content: input }],
      };

      // Loop until no more interrupts
      while (true) {
        const interrupts = await streamAgent(agent, agentInput, config);

        if (interrupts.length === 0) {
          break; // No more interrupts, we're done
        }

        // Handle all interrupts
        const decisions: any[] = [];
        for (const interrupt of interrupts) {
          decisions.push(await handleInterrupt(interrupt, rl));
        }

        // Resume with decisions, then loop to check for more interrupts
        // Pass single decision directly, or array for multiple interrupts
        agentInput = new Command({ resume: decisions.length === 1 ? decisions[0] : decisions });
      }
    } catch (error) {
      console.error(error);
    }

    rl.resume();
  }
  console.log(chalk.red("👋 Bye..."));
  process.exit(0);
}

// Run the main function
main().catch((err) => console.error(err));
````

## Running the Agent

### Run the agent

```bash
bun run main.ts
```

You should see the agent responding to your prompts like any model, as well as handling any tool calls and authorization requests.

## Next Steps

- Clone the [repository](https://github.com/arcade-agents/ts-langchain-Zendesk) and run it
- Add more toolkits to the `toolkits` array to expand capabilities
- Customize the `systemPrompt` to specialize the agent's behavior
- Explore the [Arcade documentation](https://docs.arcade.dev) for available toolkits

