// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

function stripContextTag(modelStr) {
  return typeof modelStr === "string" ? modelStr.replace(/\[1m\]$/i, "") : modelStr;
}

async function resolveComboAlias(alias) {
  const aliases = await getModelAliases();
  const target = aliases?.[alias] || aliases?.[stripContextTag(alias)];
  if (typeof target !== "string" || target.includes("/")) return null;
  const combo = await getComboByName(target);
  return combo ? target : null;
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const normalizedModelStr = stripContextTag(modelStr);
  const parsed = parseModel(normalizedModelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as provider alias.
  // This prevents combo names from being incorrectly routed to providers.
  const combo = await getComboByName(parsed.model);
  if (combo) {
    return { provider: null, model: parsed.model };
  }

  // Allow aliases to point at combo names, not just provider/model strings.
  // Useful for clients with hardcoded model metadata, e.g. Claude Code 1M variants.
  const comboAlias = await resolveComboAlias(parsed.model);
  if (comboAlias) {
    return { provider: null, model: comboAlias };
  }

  return getModelInfoCore(normalizedModelStr, getModelAliases);
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  const normalizedModelStr = stripContextTag(modelStr);
  // Only check if it's not in provider/model format
  if (normalizedModelStr.includes("/")) return null;

  const directCombo = await getComboByName(normalizedModelStr);
  if (directCombo && directCombo.models && directCombo.models.length > 0) {
    return directCombo.models;
  }

  const comboAlias = await resolveComboAlias(normalizedModelStr);
  if (comboAlias) {
    const combo = await getComboByName(comboAlias);
    if (combo && combo.models && combo.models.length > 0) return combo.models;
  }

  return null;
}
