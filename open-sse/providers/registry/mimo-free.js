export default {
  id: "mimo-free",
  priority: 50,
  hasFree: true,
  alias: "mmf",
  uiAlias: "mmf",
  display: {
    name: "MiMo Code Free",
    icon: "smart_toy",
    color: "#FF6900",
    textIcon: "MF",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://api.xiaomimimo.com/api/free-ai/openai/chat",
    noAuth: true,
  },
  models: [
    { id: "mimo-auto", name: "MiMo Auto" },
    { id: "mimo-auto-claude", name: "MiMo Auto (Claude Compatible)", upstreamModelId: "mimo-auto" },
  ],
  modelsFetcher: { url: "https://models.dev/api.json", type: "mimo-free" },
  passthroughModels: true,
};
