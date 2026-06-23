import { DefaultExecutor } from "./default.js";
import { resolveXiaomiTokenplanBaseUrl } from "../config/providers.js";
import { getModelTargetFormat } from "../config/providerModels.js";
import { FORMATS } from "../translator/formats.js";

export class XiaomiTokenplanExecutor extends DefaultExecutor {
  constructor() {
    super("xiaomi-tokenplan");
  }

  // Token Plan keys are region-specific. Normal models use /chat/completions;
  // Claude-native aliases and Claude runtime transports use the region
  // Anthropic-compatible endpoint.
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrl = resolveXiaomiTokenplanBaseUrl(credentials);
    if (
      getModelTargetFormat("xiaomi-tokenplan", model) === FORMATS.CLAUDE ||
      credentials?.runtimeTransport?.format === "claude"
    ) {
      return `${baseUrl.replace(/\/v1\/?$/, "")}/anthropic/v1/messages`;
    }
    return `${baseUrl}/chat/completions`;
  }
}
