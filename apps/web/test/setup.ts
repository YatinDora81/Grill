import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";

GlobalRegistrator.register({ url: "http://localhost:4000" });

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Unmount between tests. A component left mounted keeps its timers and its
// MediaRecorder stub alive, and the next test inherits both — which is exactly
// the kind of cross-talk that makes a suite lie.
afterEach(() => {
  cleanup();
});
