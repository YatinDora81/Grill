/**
 * How the build screen tells the rail which step the user is actually on.
 *
 * `04 Building` has no URL of its own — it renders from /report/[sessionId] while
 * the report is still being written — so the pathname alone can't distinguish it
 * from the finished report at the same address. Left to the pathname the rail lit
 * `05 Report`, the step the user had NOT reached, and dimmed the screen in front
 * of them: the one state the numbered sequence exists to communicate was the one
 * it got wrong.
 *
 * A `data-step` attribute on <body> rather than a query marker, because
 * FinishReport calls `router.refresh()` on the SAME url — a `?building=1` would
 * survive into the finished report and leave 04 lit under it. The writer clears
 * the attribute in its effect's cleanup, so the handover is just an unmount.
 *
 * Same shape as explain mode's body class, for the same reason: no provider, no
 * context, and nothing above these two components has to know it exists.
 *
 * ── Why its own module ──────────────────────────────────────────────────────
 * Its own file rather than an export from `AppRail`, so the writer doesn't have
 * to import the reader. `AppRail` is a client nav component that calls
 * `usePathname`; pulling it into `FinishReport` for two string constants dragged
 * `next/navigation` into that component's test and broke it. Two strings should
 * not carry a dependency on the router.
 */
export const STEP_EVENT = "grill:step";
export const STEP_BUILDING = "building";
