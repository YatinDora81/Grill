/**
 * Test globals. Loaded by bunfig.toml before any test file.
 *
 * `bun test` runs in a bare JS runtime with no `document`, so anything that
 * renders — every hook and component in the room — needs a DOM registered before
 * React is imported, not inside the test that wants one. Server tests are
 * unaffected: they simply never touch it.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";

GlobalRegistrator.register({ url: "http://localhost:4000" });

// React 19 reads this to decide whether it is allowed to flush effects
// synchronously inside `act`. Without it every state update warns, and
// `eslint --max-warnings 0`'s cousin here is a wall of noise that hides real
// failures.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Unmount between tests. A component left mounted keeps its timers and its
// MediaRecorder stub alive, and the next test inherits both — which is exactly
// the kind of cross-talk that makes a suite lie.
afterEach(() => {
  cleanup();
});
