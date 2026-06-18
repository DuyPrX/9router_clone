// Strip multimodal content blocks a model cannot read, BEFORE translation.
// Driven by getCapabilitiesForModel: vision/audioInput/pdf. Replaces removed
// media with a short text placeholder so messages never become empty.
import { FORMATS } from "../formats.js";

// Placeholder text inserted where a media block was removed.
// Current turn: explain the active model can't read what the user just sent.
const PLACEHOLDER_CURRENT = {
  vision: "[image omitted: model has no vision support]",
  audioInput: "[audio omitted: model has no audio support]",
  pdf: "[file omitted: model has no document support]",
};
// Earlier turns: neutral (a combo may route to a different model each turn).
const PLACEHOLDER_PREV = {
  vision: "[Previous image omitted from context.]",
  audioInput: "[Previous audio omitted from context.]",
  pdf: "[Previous file omitted from context.]",
};
const ph = (cap, isLast) => (isLast ? PLACEHOLDER_CURRENT : PLACEHOLDER_PREV)[cap];

function noteRemoved(details, { cap, format, messageIndex, role, blockType, mimeType, isLast }) {
  if (!details) return;
  details.total = (details.total || 0) + 1;
  details.counts = details.counts || {};
  details.counts[cap] = (details.counts[cap] || 0) + 1;
  details.removed = details.removed || [];
  details.removed.push({
    cap,
    format,
    messageIndex,
    role,
    blockType,
    mimeType,
    turn: isLast ? "current" : "previous",
  });
}

function blockType(block) {
  return block?.type || (block?.inlineData ? "inlineData" : block?.fileData ? "fileData" : "unknown");
}

function blockMime(block) {
  return block?.source?.media_type
    || block?.file?.media_type
    || block?.file?.mime_type
    || block?.mime_type
    || block?.mimeType
    || block?.input_audio?.format
    || block?.inlineData?.mimeType
    || block?.fileData?.mimeType
    || null;
}

// Map gemini inlineData/fileData mime prefix -> capability it requires.
function capForMime(mime) {
  if (typeof mime !== "string") return null;
  if (mime.startsWith("image/")) return "vision";
  if (mime.startsWith("audio/")) return "audioInput";
  if (mime === "application/pdf") return "pdf";
  return null;
}

// OpenAI chat content block -> required capability (null = plain text/other, keep).
function capForOpenAIBlock(block) {
  const t = block?.type;
  if (t === "image_url" || t === "image") return "vision";
  if (t === "input_audio" || t === "audio_url") return "audioInput";
  if (t === "file") return "pdf";
  return null;
}

// Claude content block -> required capability.
function capForClaudeBlock(block) {
  const t = block?.type;
  if (t === "image") return "vision";
  if (t === "document") return "pdf";
  return null;
}

// Filter an array of content blocks; drop unsupported, inject one placeholder per kind.
// isLast = block belongs to the current user turn (picks the explanatory placeholder).
function filterBlocks(blocks, capOf, caps, removed, isLast, details, meta = {}) {
  const out = [];
  for (const block of blocks) {
    const cap = capOf(block);
    if (cap && caps[cap] === false) {
      removed.add(cap);
      noteRemoved(details, {
        cap,
        format: meta.format,
        messageIndex: meta.messageIndex,
        role: meta.role,
        blockType: blockType(block),
        mimeType: blockMime(block),
        isLast,
      });
      continue;
    }
    out.push(block);
  }
  for (const cap of removed) out.push({ type: "text", text: ph(cap, isLast) });
  return out;
}

// OpenAI / OpenAI-compatible chat messages[].content[].
function stripOpenAI(body, caps, details) {
  if (!Array.isArray(body.messages)) return;
  const last = body.messages.length - 1;
  body.messages.forEach((msg, i) => {
    if (!Array.isArray(msg.content)) return;
    const removed = new Set();
    msg.content = filterBlocks(msg.content, capForOpenAIBlock, caps, removed, i === last, details, {
      format: "openai", messageIndex: i, role: msg.role,
    });
  });
}

// Claude messages[].content[].
function stripClaude(body, caps, details) {
  if (!Array.isArray(body.messages)) return;
  const last = body.messages.length - 1;
  body.messages.forEach((msg, i) => {
    if (!Array.isArray(msg.content)) return;
    const removed = new Set();
    msg.content = filterBlocks(msg.content, capForClaudeBlock, caps, removed, i === last, details, {
      format: "claude", messageIndex: i, role: msg.role,
    });
  });
}

// OpenAI Responses input[].content[] (input_image / input_file).
function stripResponses(body, caps, details) {
  if (!Array.isArray(body.input)) return;
  const last = body.input.length - 1;
  body.input.forEach((item, i) => {
    if (!Array.isArray(item.content)) return;
    const removed = new Set();
    item.content = item.content.filter((b) => {
      const cap = b?.type === "input_image" ? "vision" : b?.type === "input_file" ? "pdf" : null;
      if (cap && caps[cap] === false) {
        removed.add(cap);
        noteRemoved(details, { cap, format: "responses", messageIndex: i, role: item.role, blockType: blockType(b), mimeType: blockMime(b), isLast: i === last });
        return false;
      }
      return true;
    });
    for (const cap of removed) item.content.push({ type: "input_text", text: ph(cap, i === last) });
  });
}

// Gemini / gemini-cli contents[].parts[] (inlineData / fileData by mime).
function stripGeminiParts(contents, caps, details, format = "gemini") {
  if (!Array.isArray(contents)) return;
  const last = contents.length - 1;
  contents.forEach((c, i) => {
    if (!Array.isArray(c.parts)) return;
    const removed = new Set();
    c.parts = c.parts.filter((p) => {
      const mime = p?.inlineData?.mimeType || p?.fileData?.mimeType;
      const cap = capForMime(mime);
      if (cap && caps[cap] === false) {
        removed.add(cap);
        noteRemoved(details, { cap, format, messageIndex: i, role: c.role, blockType: blockType(p), mimeType: mime, isLast: i === last });
        return false;
      }
      return true;
    });
    for (const cap of removed) c.parts.push({ text: ph(cap, i === last) });
  });
}

/**
 * Remove media blocks the model can't read, in-place on the source-format body.
 * @param {object} body - request body (source format)
 * @param {string} sourceFormat - one of FORMATS
 * @param {object} caps - capabilities from getCapabilitiesForModel
 * @returns {boolean} true if anything was stripped-eligible (cap false for some modality)
 */
export function stripUnsupportedModalities(body, sourceFormat, caps, details = null) {
  if (!body || !caps) return false;
  // Fast exit: model supports everything we'd strip.
  if (caps.vision !== false && caps.audioInput !== false && caps.pdf !== false) return false;

  switch (sourceFormat) {
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      stripOpenAI(body, caps, details);
      break;
    case FORMATS.CLAUDE:
      stripClaude(body, caps, details);
      break;
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
    case FORMATS.CODEX:
      stripResponses(body, caps, details);
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      stripGeminiParts(body.contents, caps, details, "gemini");
      break;
    case FORMATS.ANTIGRAVITY:
      stripGeminiParts(body?.request?.contents, caps, details, "antigravity");
      break;
    default:
      stripOpenAI(body, caps, details);
  }
  return true;
}
