import { lookup } from "node:dns/promises";
import { Agent } from "undici";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return false;
  const [a, b] = v4.slice(1).map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

async function resolvePinnedIps(hostname) {
  if (!hostname || BLOCKED_HOSTS.has(hostname.toLowerCase())) return null;
  try {
    const records = await lookup(hostname, { all: true });
    if (!records.length || records.some((record) => isPrivateIp(record.address))) return null;
    return records;
  } catch {
    return null;
  }
}

/**
 * Fetch a remote image URL and return it as a base64 data URI.
 * Used when upstream providers (Codex, etc.) require inline base64 images
 * instead of remote URLs they cannot fetch.
 * Returns null if fetch fails.
 *
 * @param {string} imageUrl - HTTP(S) URL of the image
 * @param {object} options - { signal, timeoutMs }
 * @returns {Promise<{url: string, mimeType: string}|null>}
 */
export async function fetchImageAsBase64(imageUrl, options = {}) {
  const { signal, timeoutMs = 10000 } = options;
  if (!imageUrl || (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))) {
    return null;
  }

  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }

  const pinnedIps = await resolvePinnedIps(url.hostname);
  if (!pinnedIps) return null;

  const controller = new AbortController();
  const timeout = signal ? null : setTimeout(() => controller.abort(), timeoutMs);
  const fetchSignal = signal || controller.signal;
  const dispatcher = new Agent({
    connect: { lookup: (_hostname, _options, callback) => callback(null, [{ address: pinnedIps[0].address, family: pinnedIps[0].family }]) },
  });

  try {
    const response = await fetch(imageUrl, { signal: fetchSignal, redirect: "manual", dispatcher });
    if (!response.ok || !response.body) return null;

    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      const buf = Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_IMAGE_BYTES) return null;
      chunks.push(buf);
    }

    const mimeType = response.headers.get("Content-Type") || "image/jpeg";
    const base64 = Buffer.concat(chunks).toString("base64");
    return { url: `data:${mimeType};base64,${base64}`, mimeType };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
    dispatcher.close().catch(() => {});
  }
}
