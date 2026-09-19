# findings / pitfalls / skills

Distilled from comparing 7 prototypes (GLM v2/v3, gpt-luna, kimi-K26-A,
0.2-sticky, VNS_e4ar main + branch 1). See 0.0-plan-overview.md for the full
matrix.

## wagons

- Parking belongs on the compositor (`position:sticky`), pushing in JS.
  Fully JS-driven parking lags fast flicks by a frame; sticky never does.
- Run the push chain in a synchronous passive scroll handler, not rAF.
  rAF coalescing is the lag; a sync handler doing O(N) math + gated
  transform writes is what "proven smooth" prototypes do.
- Engine writes only `desired − stickyShown`. Riding or parked ⇒ delta is 0
  ⇒ write gating skips the DOM and the compositor did the work.
- Mirror CSS sticky parent-aware in math
  (`min(max(free,0),parentBottom−ext)`), then *extend* it: when the parent
  ends before the next wagon arrives, hold via positive delta.
- A taller-than-parent sticky box DOES park at `top:0` while the parent is
  visible (the margin box is what fits, and with overlay flow it is tiny)
  and releases to `parentBottom − ext − mb` after. Never shortcut the mirror
  with `ext>=pH ⇒ flow` — it misplaces wagons by `−free`.
- Chain is 1D (`pos[i]=min(park[i],pos[i+1]−ext[i])`), exits projected after.
  Never feed a 2D exit (bottom/left/right) back into the chain — a bottom
  exit un-pushes the wagon above it (observed bug).
- CSS sticky constrains the MARGIN box within the parent CONTENT box:
  mirror is `min(max(free,0), pBotContent − ext − marginBottom)`, verified
  to the pixel. Border-box bottom is off by padding+border; ignoring the
  (negative ok) marginBottom is off by exactly its value. Engine zeroes
  wagon marginTop/Left/Right so marker Y == border-top.
- Positioned wagons paint ABOVE loose text regardless of DOM order —
  `z-index:-1` on the wagon is what puts the picture behind the prose
  (and below any text-container background, so chapter boxes must be
  transparent; readability via text-shadow).
- Strict measure phases: box writes → ext reads → margin writes → anchor
  reads. marginBottom shifts shared parents, so interleaved per-wagon
  write+read measures stale parent rects (observed: same section measured
  136px apart for two wagons).
- `data-dir` is the wagon's own exit, never the pusher's action.
  Pusher-dictates reads as "this picture leaves differently depending on who
  pushes it".
- Lateral `x` must scale push depth to viewport width (`f=d/ext·vw`), not 1:1
  pixels — 1:1 strands a 256px box mid-page.
- Exits key on past-edge depth `dp=max(−pos,0)`, not full `d`: while riding,
  every wagon rides the chain exactly like a top exit. Keying lateral `x` on
  `d` detaches coupled wagons sideways from their text before they park.
- anchorAlign must ask the engine (`pos < park−1`) whether a wagon is pushed:
  coupling propagates from below, so a positive single-gap cushion does not
  prove the wagon rides free. Skip coupled wagons, report the count.
- `overflow:hidden|scroll|auto` on any wagon/stick ancestor traps `sticky`
  and silently kills parking. Horizontal safety is `overflow-x:clip`.
- Culling with `display`/`visibility` pops on reverse scroll — leave
  off-screen wagons transformed, never toggle.
- `data-gap` (flow footprint) via `margin-bottom:calc(gap−height)`: 0 =
  text scrolls over the parked picture; 100vh = pure image beat.

## anchors & measurement

- `offsetTop` is offsetParent-relative — wrong under positioned ancestors.
  Zero-size abspos markers (`<i>` before the element) + one GBR loop per
  refresh is the robust anchor.
- Never read the wagon's own rect for its anchor (it is transformed); never
  measure inside `frame()` (self-referential drift); never write layout
  props in `frame()` (invalidates anchors → "wagon crawls").
- `<script>` is `display:none`: trigger height is 0, trigger = the tag's own
  line. Author moves the tag, moves the trigger. No section heuristics.
- `data-size`/`data-w`/`data-h` instead of natural image size: no async
  decode in the measure path, ever.

## morph & events

- Lerp colours in linear light (LUTs), not sRGB — sRGB midpoints go muddy.
  Alpha is the only 0-1 channel; components are 0-255 with `%` support.
- Size the linear→sRGB table at 4096, not 256 — a 256-entry table quantises
  the dark end to ±6 sRGB steps. Gate: round-trip sRGB→linear→sRGB must be
  exact for all 256 inputs (check in node).
- Explicit `data-range` longer than the anchor interval creates overlapping
  morph zones, which snap at the middle anchor (incoming completes exactly
  where outgoing is already 2/3 done). Clamp each zone's effective start to
  the previous value anchor's Y and divide by the effective span — ranges
  compress instead of snapping, arrival stays exact.
- Morph target search must skip anchors that lack the channel; otherwise
  crossing a channel-less anchor re-pairs (source, target, t) mid-gradient
  and jumps.
- One reading line (`scrollY+vh/2`) for segment choice, lerp, and class swap;
  morph completes *at* the anchor so `t==1` meets the class swap exactly.
- No `transition` on themed colour props — the lerp is the smoothing; a
  transition makes colour history-dependent (same Y, two colours).
- Hysteresis on the reset edge only; `parked` must be in the reset mask but
  never cleared on unpark (re-fires on reverse scroll).
- `view`/`center` as viewport overlap (not edge crossing) is what makes
  `skip` distinguishable from `end` after a flick.
- Pre-fill event latches for above-the-fold anchors at load — restored
  scrollY must not re-fire the whole story in one frame.
- No `IntersectionObserver` for scroll state: batched, irreversible, blind
  to transform-only states like `parked`.

## sticks

- Bottom sticks in unscoped (flat/loose) content pile up: every not-yet-reached
  `bottom:0` stick is engaged at once and later DOM paints above. Scope stick
  chapters in `<section>` for clean replace behaviour; QA asserts *a* stick is
  on top (above wagons), not *which* one.

## harness & QA

- GUI buttons run QA (no npm, no console); node `test/math.js` is the
  zero-dep gate that must stay green. Never compare formatted `translate3d`
  strings across engines — parse numbers with a tolerant regex.
- QA is single-flight, stops autoscroll first, uses instant `scrollTo` + 2
  rAF (smooth scroll never settles), and re-fetches engine records after
  every settle (a mid-run `refresh()` swaps geometries).
- A generated attribute value must never contain its own closing quote;
  build bare `data:image/svg+xml` URIs (`encodeURIComponent`, raw `#`
  truncates) and wrap at the call site.
- `background-image:<gradient> 50%/72px` is invalid CSS (position/size need
  the `background` shorthand) — emit `background-size` separately.
- Prove every gate fails before trusting it green: break one thing, re-run.
- Integer `scrollY` cannot hit a fractional anchor Y: sample arrival holds
  1px *past* the anchor (bit-exact from above) and budget ±0.5px landing on
  both ends of any gradient-step bound (true Δc ≤ 2).
- `qStickSlots` must encode the true sticky rule — min/max of flow position,
  viewport slot, and parent content-box constraint *including the stick's
  own margins* — because short pages legitimately clamp the probe scroll at
  `maxY` and short sections legitimately constrain the park.

## events (0.4)

- Pre-fill belongs in the first `frame()` after `measure`, not in `measure`:
  wagon `pos/free` are only fresh after wagonsFrame runs in the same
  coreFrame. Pass `replay` through `refresh()` so QA can skip pre-fill.
- `parked` must be gated on the anchor being in the viewport, not just the
  wagon state — otherwise huge chapters fire it while far below, `view`
  stops firing first, and re-arm + a still-pinned wagon fires it on the
  reverse leg.
- Scripts sharing an anchor Y (<1px apart) share flags; OR all five `decl`
  bits into the anchor so a sibling `view` suppresses the anchor's `skip`.
- Reuse `<i>` markers across refreshes (check `parentNode`, update stamp):
  stamping a new marker per refresh leaks one orphan node per anchor.
- Threshold QA reads `events.flags` (the latch itself), not LOG counts —
  1px steps around each threshold prove ±2px without fighting integer
  `scrollY` vs fractional anchor Y.

## integration & vendoring (0.5.5)

- Two-way vendoring drifts, measurably: the engine and its vendored copy in
  the asset repo diverged by 180 diff lines within a few commits — four
  engine fixes existed only downstream, the newest engine work only upstream.
  Vendor in ONE direction, keep one trunk per kind of file, and stamp the copy
  (`vendor/VERSION.txt`) so a `--check` command goes red instead of a browser.
- `git diff <old>:snowfall.js vendored-copy | wc -l` against a few candidate
  commits finds a fork's origin in seconds; `git fetch --unshallow` first if
  the checkout is shallow (`.git/shallow` present).
- Submodules are the wrong tool for a `file://` double-click runtime: a source
  zip and a plain `git clone` both leave the directory empty, and nothing
  errors — the page just silently loses a feature.
- An engine-side fix that a downstream adapter needed is still an engine fix.
  Upstream it and re-sync; patching the copy is how the fork above happened.

## 0.5.5 region gates — techniques and pitfalls (node-testable)

- **Simulate the frame loop headless.** The sticky/park clamp's promises (finite
  scroll range, monotone entry, per-frame motion ≤ step) are statements about
  iterated engine frames, which no static unit test can see. `test/math.js`
  reimplements the chain + clamp in ~15 lines (`simFrame`) and scans thousands
  of synthetic frames per layout — including a deliberately **unclamped control
  run** that the same assertions must reject. An invariant gate that does not
  first demonstrate failure on the buggy variant proves nothing; the control run
  is what makes "bounded by the parent, never re-enters" a real gate. (The
  control also caught a plan overclaim: `pos` converges to 0 at top-exit but
  plateaus at −2·cap while the parent itself drifts — assert the validated form.)
- **Clamp where the consumer reads, not where you'd naively write.** Clamping
  `pos` inside the chain loop (before `y+pos` becomes the next wagon's ceiling)
  teleports `dir=3` wagons ~600px when the cap crosses; after the loop, the only
  overlap created is between two wagons already above the viewport top. Also:
  the chain's ceilings must be built from pre-clamp positions, so a parent's
  departure never pushes a parked child's cap down — otherwise the child re-enters.
- **Gates must reuse the implementation's exact comparison, tolerance-free, for
  conditional invariants.** "The region-visibility clamp applies *if* the scaled
  region fits" is `pLen <= win`; when the fuzz asserted it with ±1e-9 slack on
  the size test, ~0.25% of random layouts disagreed by one ULP (hw/vw =
  1.0000000000000002). The fixed gate checks `out.hw <= vw` — the identical
  float expression the clamp guards — and is silent. Tolerances belong on
  *measurements*, never on predicates that mirror an `if`.
- **In a node test of a browser module, the fakes are the bug surface.** These
  files run as `(function(global){…})(typeof window !== 'undefined' ? window :
  globalThis)`: once a fake `global.window` exists, everything the module reads
  "off global" (`global.HDRegion`, `global.REGIONS`, `global.Snowfall`) must
  hang off the **fake window**, not globalThis — fakes placed on globalThis
  produce silent no-ops (a "0 of 3 managed" that looks like an adapter bug).
  A `querySelectorAll` fake keyed on selector substring plus one `fakeEl()`
  factory (style/dataset/classList/children-wiring) is enough to run the real
  engine + adapter end-to-end; a bare `{length:0}` NodeList keeps the engine's
  layout pass inert while the viewport contract still exercises.
- **`Function#toString` replaces the forbidden fetch.** The static scans (no
  `getBoundingClientRect`/`getComputedStyle`/allocation literals in the frame
  body, no `innerWidth` anywhere in a region file) must run in the GUI under
  file:// too — `fetch('./snowfall-region.js')` would die on CORS there. The
  adapter exposes its subscribed functions on its namespace; stringifying those
  (and the harness's own source via `qMorph`'s existing fetch path, which is
  http-only anyway) scans the shipped bytes without any I/O.
- **Determinism needs a seeded generator, not `Math.random`.** One `mulberry32`
  copy in the test files turns the fuzz into a reproducible regression: failure
  output prints the exact `t=` parameters, and re-running at the same seed is
  byte-identical. (Same seed constant `0xC0FFEE` in both gates.)
- **A gate that never runs the hot loop certifies nothing.** The 0.5.5 clamp edit
  to `wagonsFrame` swallowed the `let active/parked/pushed/writes = …` line in
  the replaced context; `node --check` passed (ReferenceError is runtime), and
  both gates stayed green — the fake DOM had zero `.snow-bg` elements, so the
  frame returned at the `if (!n)` guard. The user's browser hit it at once, and
  the boot-time throw killed the harness menu before its bindings registered.
  Fix: the engine gate now plants one fake wagon in the fake tree and asserts
  `wagons.n === 1` plus a `translate3d(` write — every statement in the loop
  executes on each gate run. Then the negative control: deleting the declaration
  must fail the gate (it does). Any integration fixture whose main path is
  guarded by `if (!n) return` with n forced 0 is a hole, not a test.
