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
- Chain is 1D (`pos[i]=min(park[i],pos[i+1]−ext[i])`), exits projected after.
  Never feed a 2D exit (bottom/left/right) back into the chain — a bottom
  exit un-pushes the wagon above it (observed bug).
- `data-dir` is the wagon's own exit, never the pusher's action.
  Pusher-dictates reads as "this picture leaves differently depending on who
  pushes it".
- Lateral `x` must scale push depth to viewport width (`f=d/ext·vw`), not 1:1
  pixels — 1:1 strands a 256px box mid-page.
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
