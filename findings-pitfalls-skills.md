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

## 0.5.5 region fit & framing — one feature, two independent defects

Two branches shipped "HD regions" and both looked wrong the same way: the sharp
crop was a small patch on a blurry field, off-centre. Comparing them against the
standalone `HD-region` reference separated two causes that had been fused into
one symptom, and both were real in main.

- **The filler must not set the scale.** `s0 = min(cover, room)` — "cover the
  window with the base, but not so much that the region leaves it" — reads like
  a safety belt and is a shrink ray: whenever the base is large relative to the
  window, `cover` wins and the crop lands at a fraction of the frame (measured:
  a 600×400 rect of a 1600×1000 base in a 1440×900 window came out 540×360,
  15% of the frame; the reference gives 1350×900, 94%). The region *is* the
  picture; the outpainted base is what follows it, at the same scale: `s0 =
  min(vw/rw, vh/rh)`. Only when the "region" is the whole base (no entry, or a
  rect covering the art) does the plain-background rule apply, `s0 =
  max(vw/bw, vh/bh)` — a picture with nothing to protect covers, never
  letterboxes. Consequence worth knowing: one shared scale means a portrait
  phone with a wide crop can show page background above and below the base
  (the base simply cannot reach both edges); centring the crop instead would
  put the *picture* off-centre to place a sub-rect in the middle, which is
  worse. The gaps are what outpaint is for, not what the fit is for.
- **`min(a,b)`-style "safety" caps are invisible to gates that only test
  containment.** I1 (region visible) and I2 (base covers) both held while the
  art was 15% of the screen, because they bound the *placement*, not the size.
  The missing invariant is the scale identity: `s/zoom` must equal the region
  fit (or cover, for a whole base) *exactly* — an equality gate, not an
  inequality. It is now I4 in the fuzz and a size check in the GUI probe.
- **A raw box position must not double as "untouched".** The other branch kept
  `view = {zoom, vx, vy}` with `vx/vy` the base top-left in window space, so
  `0, 0` meant "base corner in the window corner" and every reset landed there:
  for the harness data the only positions that keep the crop visible *and* the
  base covering were x ∈ [−562.5, −472.5], and a 0-default put it flush right,
  45px off-centre — a composition decided by an unassigned field. It also makes
  a resize un-reframable (an absolute position from a 1440px window is nonsense
  at 390px). Store `panX/panY` as an *offset from the derived rest framing*
  (region centred, coverage pinning it when centring would uncover): `0, 0`
  then genuinely means nobody touched it, it is comparable across window sizes,
  and every state is relative to a quantity the layout already computes.
  `finalLayout` re-persists the clamped pan (`x − restX`) so the clamp has one
  authority; `rest + (x − rest)` costs a few ulps per frame, which is why the
  write gates compare with a 1/100px tolerance (`same()`) instead of `!==` —
  and NaN fails that comparison *by construction*, so the same helper serves as
  the "force a repaint" sentinel after `off()` without a parallel flag.
- **Verifying written numbers cannot verify placement.** Both branches agreed
  with `HDRegion` to the last decimal and still painted the crop in the wrong
  place, because the check was "style string == math". A GUI probe must read
  `getBoundingClientRect` (a probe privilege, never frame() code) against the
  window-space box, and start from the premise that makes a child translate mean
  window placement at all: the *parked* wagon box equals the viewport. It also
  needs one residual that ignores the math entirely — the crop rect compared
  with `base.rect + entry·(base.rect/base.natural)` — so a mistake both sides
  share cannot cancel out inside the comparison.
- **Degrade coherently, per input.** An entry with a rect but no `hd` has
  nothing to paint from the rect, so the rect must stop being a layout input:
  compute `hdOK` first and read the fit rect from `entry && hdOK ? entry :
  null`. Magnifying the base to fit a hidden rectangle draws a blurry zoom of
  nothing, and it is invisible to every geometry check (the crop stays hidden,
  so nobody compares it).
- **`off()` must invalidate, not just unwrite.** `Snowfall.setEnabled(true)`
  only steps — no measure, no re-walk — so caches left warm come back with
  children that have no size at all. Same reason `ready(snow-ready)` is
  re-asserted from `frame()`, not only from `measure()`. The GUI probe's
  disable/enable round trip (styles cleared, then repainted byte-identically) is
  the only thing that catches this class; it runs last in `qaAll` for exactly
  that reason.

## 0.5.5 region parity — when a defensible policy is still the bug

The first fix (see the section above) got the *direction* right and still did
not fit, because it fixed main's deviation from the reference by inventing a
second, better-sounding rule. Both inventions were the bug. What made the
difference was stopping the argument and comparing numbers against the reference
implementation, on the reference's own images and rects.

- **"The background must cover, never letterbox" is not a law.** It justified
  `s0 = max(vw/bw, vh/bh)` whenever the region was the whole base (no entry, no
  `hd`, rect = picture). A `.snow-hd` wagon is not a plain cover image: its base
  is outpainted filler, and the reader came for the picture. Fitted into the
  window means *contained*, bands and all — bands are what any `auto` image
  gets, and `cover` pays for them by cutting art off. Symmetric lesson: `min`
  with coverage was the original bug, `max` for the whole base is its mirror. If
  a rule reads like a principle ("a background must fill its box"), check it
  against the reference before shipping it — the reference has no special case
  and asked for none.
- **Never clamp the reader to keep the art in frame.** I1 was implemented as a
  region-visibility *sub-interval inside the placement clamp* — "helpful", and
  fatal: because the fit makes the crop exactly as tall as the window on its
  limiting axis, the interval collapses to the rest position on that axis, so
  vertical dragging did nothing at zoom 1, and on the other axis the crop could
  never be pushed past a window edge to look at the filler around it. Region
  visibility is guaranteed by the *fit* at the rest framing; the clamp's only
  job is coverage. Gate it as a *responsiveness* property (I5: +10 px of pan
  must move the box 10 px unless a box edge stopped it) — an invariant phrased
  as "X stays inside Y" cannot catch a clamp that should not exist, because the
  clamp satisfies it by construction.
- **Containment invariants cannot settle a policy argument.** I1/I2/I4 all held
  while the picture was wrong, because they bound where a box may be. What
  catches it is an *oracle*: keep a pinned copy of the reference module in
  `test/vendor/`, run both over the reference's real scene data and a fuzz, and
  require 1e-6 agreement — scale, position, box, and the state left behind by a
  zoom. The fixture header says "do not edit: an edit here is a silent change of
  the oracle", and the scenes come from that repo's `regions.js` with image dims
  read off the shipped files, so the data cannot be adjusted to make a test pass.
- **Read the generator, not only the viewer.** `tools/make_scene.py` is what
  defines the material: filler = canvas with a **smeared 1/16 remnant** in the
  ROI (not black, not a global blur), crop = **1:1 with the rect** (not a 2×
  supersample). "1:1" is why the fit scale is also the crop's native density; a
  harness that fakes the pair at 2× and a global blur keeps every number
  consistent and quietly changes what the feature is for. Vendored the four
  example files and the four tools so the repo can both show and produce real
  scenes; `save regions.js` from the browser then writes a regions.js whose keys
  are the shipped paths.
- **Give the harness the real thing as a switch, not a rewrite.** A `real scenes`
  checkbox that mounts `img/*.avif` with the reference rects costs ~15 lines and
  makes the browser view directly comparable to the reference demo. Keep the
  synthetic generator for the shape sweep (it varies size/aspect/position on
  demand and needs no files); keep the real files for the eye test.
- **A QA fixture can hide an adapter bug by being nicer than reality.** The
  `nohd` case (rect, no crop to paint) must have a *visible-if-broken* second
  `<img>`: pre-hiding it in the markup, or in a fixture's style, makes a broken
  adapter look correct. The gate now asserts the crop is NOT pre-hidden, and
  that `off()` — not the markup — is what clears it.
