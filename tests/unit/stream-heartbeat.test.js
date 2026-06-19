import assert from "node:assert/strict";
import test from "node:test";

import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";

test("emits SSE heartbeats while transformed output is idle", async () => {
  let sourceController;
  const delayed = {
    readable: new ReadableStream({
      start(controller) { sourceController = controller; }
    }),
    writable: {
      getWriter: () => ({ abort: () => Promise.resolve() })
    }
  };
  const controller = {
    isConnected: () => true,
    handleComplete() {},
    handleError(error) { throw error; },
    handleDisconnect() {}
  };

  const output = createDisconnectAwareStream(delayed, controller, null, 10);
  const readPromise = new Response(output).text();
  setTimeout(() => {
    sourceController.enqueue(new TextEncoder().encode("data: done\n\n"));
    sourceController.close();
  }, 35);

  const text = await readPromise;
  assert.match(text, /: keepalive\n\n/);
  assert.match(text, /data: done\n\n/);
});
