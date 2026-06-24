import { DefaultExecutor } from "./default.js";

function isClaudeModel(model) {
  return typeof model === "string" && model.toLowerCase().startsWith("claude-");
}

export class AgentRouterExecutor extends DefaultExecutor {
  constructor() {
    super("agentrouter");
  }

  buildUrl(model) {
    return isClaudeModel(model)
      ? "https://agentrouter.org/v1/messages"
      : "https://agentrouter.org/v1/chat/completions";
  }

  buildHeaders(credentials, stream = true, model = null) {
    const headers = super.buildHeaders(credentials, stream, model);
    if (!isClaudeModel(model)) {
      delete headers["x-api-key"];
      headers.Authorization = `Bearer ${credentials.apiKey || credentials.accessToken}`;
    }
    return headers;
  }
}
