let pyodide = null;
let loading = null;
let indexURL = "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/";

function load(url) {
  if (url) indexURL = url;
  if (!loading) {
    importScripts(indexURL + "pyodide.js");
    loading = self.loadPyodide({ indexURL }).then((py) => {
      pyodide = py;
      self.postMessage({ type: "ready" });
      return py;
    });
  }
  return loading;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === "load") {
    try {
      await load(msg.indexURL);
    } catch (err) {
      self.postMessage({ type: "error", message: String((err && err.message) || err) });
    }
    return;
  }
  if (msg.type !== "run") return;
  try {
    const py = pyodide || (await load(msg.indexURL));
    const lines = String(msg.stdin || "").split("\n");
    let li = 0;
    const out = [];
    const err = [];
    py.setStdin({ stdin: () => (li < lines.length ? lines[li++] + "\n" : null), autoEOF: true });
    py.setStdout({ batched: (s) => out.push(s) });
    py.setStderr({ batched: (s) => err.push(s) });
    const t0 = performance.now();
    try {
      await py.runPythonAsync(String(msg.source || ""));
    } catch (ex) {
      err.push(String((ex && ex.message) || ex));
    }
    self.postMessage({
      type: "result",
      id: msg.id,
      stdout: out.join("\n"),
      stderr: err.join("\n"),
      time_ms: Math.round(performance.now() - t0),
    });
  } catch (ex) {
    self.postMessage({ type: "error", id: msg.id, message: String((ex && ex.message) || ex) });
  }
};
