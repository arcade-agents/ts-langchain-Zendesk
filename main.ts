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

const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});



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

const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});

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