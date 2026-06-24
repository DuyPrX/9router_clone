import { CLAUDE_CLI_SPOOF_HEADERS } from "../shared.js";

export default {
  id: "agentrouter",
  priority: 305,
  alias: "agentrouter",
  display: {
    name: "AgentRouter",
    icon: "router",
    color: "#10B981",
    textIcon: "AR",
    website: "https://agentrouter.org",
    notice: {
      text: "Multi-model gateway requiring Claude Code client identity headers.",
      apiKeyUrl: "https://agentrouter.org/console/token",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://agentrouter.org/v1/messages",
    format: "claude",
    headers: { ...CLAUDE_CLI_SPOOF_HEADERS },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
      anthropicVersion: true,
    },
    fetchConnectTimeoutMs: 60 * 1000,
    stallTimeoutMs: 180 * 1000,
    streamMaxDurationMs: 5 * 60 * 1000,
  },
  models: [
    { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "gpt-5.5", name: "GPT-5.5", targetFormat: "openai" },
  ],
  serviceKinds: ["llm"],
};
