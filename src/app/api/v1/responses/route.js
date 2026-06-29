import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

function normalizeUsage(usage = {}) {
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: usage.total_tokens ?? input + output,
  };
}

function messageText(message = {}) {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    return part?.text || part?.content || "";
  }).join("");
}

function chatCompletionToResponses(data) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const output = [];
  let outputIndex = 0;

  const reasoning = message.reasoning || message.reasoning_content;
  if (typeof reasoning === "string" && reasoning.trim()) {
    output.push({
      id: `rs_${data.id || Date.now()}`,
      type: "reasoning",
      summary: [{ type: "summary_text", text: reasoning }],
    });
    outputIndex += 1;
  }

  const text = messageText(message);
  if (text) {
    output.push({
      id: `msg_${data.id || Date.now()}_${outputIndex}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", annotations: [], text }],
    });
    outputIndex += 1;
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const toolCall of toolCalls) {
    const fn = toolCall.function || {};
    output.push({
      id: toolCall.id ? `fc_${toolCall.id}` : `fc_${data.id || Date.now()}_${outputIndex}`,
      type: "function_call",
      call_id: toolCall.id || `call_${outputIndex}`,
      name: fn.name || "",
      arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}),
    });
    outputIndex += 1;
  }

  return {
    id: String(data.id || "").startsWith("resp_") ? data.id : `resp_${data.id || Date.now()}`,
    object: "response",
    created_at: data.created || Math.floor(Date.now() / 1000),
    status: choice.finish_reason === "length" ? "incomplete" : "completed",
    model: data.model,
    output,
    output_text: text,
    usage: normalizeUsage(data.usage),
  };
}

async function normalizeResponsesJson(response) {
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;

  const data = await response.json();
  if (data?.object !== "chat.completion") {
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: response.headers,
    });
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(chatCompletionToResponses(data)), {
    status: response.status,
    headers,
  });
}

/**
 * POST /v1/responses - OpenAI Responses API format
 * The generic chat handler preserves 9router combo/auth/fallback behavior. Some
 * OpenAI-compatible upstreams return Chat Completions JSON, so normalize the
 * final non-streaming JSON back to Responses shape for Codex clients.
 */
export async function POST(request) {
  await ensureInitialized();
  const response = await handleChat(request);
  return await normalizeResponsesJson(response);
}
