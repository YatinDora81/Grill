for (const name of [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "importScripts",
  "Worker",
  "SharedWorker",
  "indexedDB",
  "caches",
  "navigator",
]) {
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {}
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== "run") return;
  const out = [];
  const err = [];
  const lines = String(msg.stdin || "").split("\n");
  let li = 0;
  const readLine = () => (li < lines.length ? lines[li++] : null);
  const readAll = () => {
    const rest = lines.slice(li).join("\n");
    li = lines.length;
    return rest;
  };
  const fmt = (args) =>
    args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
  const con = {
    log: (...a) => out.push(fmt(a)),
    info: (...a) => out.push(fmt(a)),
    debug: (...a) => out.push(fmt(a)),
    error: (...a) => err.push(fmt(a)),
    warn: (...a) => err.push(fmt(a)),
  };
  const t0 = performance.now();
  try {
    const fn = new Function(
      "console",
      "readLine",
      "readAll",
      '"use strict";\nreturn (async () => {\n' + String(msg.source || "") + "\n})();",
    );
    await fn(con, readLine, readAll);
  } catch (ex) {
    err.push(String((ex && ex.stack) || ex));
  }
  self.postMessage({
    type: "result",
    id: msg.id,
    stdout: out.join("\n"),
    stderr: err.join("\n"),
    time_ms: Math.round(performance.now() - t0),
  });
};
