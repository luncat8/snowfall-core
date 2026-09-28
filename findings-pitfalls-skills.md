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
- Pre-fill only the anchors *already past* at load (`Y < scrollY`) — restored
  scrollY must not re-fire the whole story in one frame. Anchors inside the
  load viewport are not latched: the reader is looking at them, so their
  `view` fires in that same frame, live. Latching them makes a first-screen
  script dead forever (`skip` is suppressed while `view` is latched, and
  `Y <= vh` can never re-arm).
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
- Put event fixtures immediately **before** the trailing run-out, never after
  it. The run-out supplies the scroll range needed to cross the fixture's end;
  an anchor after it sits below `maxY` and produces a convincing false failure.
- Removing a temporary script from the DOM does not remove its compiled event
  callback. Refresh the engine before deleting callback globals, or later
  probe scrolls execute stale scripts and turn cleanup into page errors.

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

## choices & score (0.4.1)

- **`ask` records every resolution, not only live answers.** In replay mode and
  on abandon the engine resolves `saved`/`default` *and* writes the outcome
  into `keys` (marking a fallback in `defaults`), so a `sum`-derived total
  counts a chapter the reader skipped. Two designs were tried before that one:
  a store that kept live answers only (a skipped chapter silently scored 0
  while its own label read `default 1`), and an author-side grant into `vars`
  (double-counted the chapters the engine had already recorded — `sum` adds
  `vars` + `keys`). Deciding what a skipped chapter is worth belongs to the
  engine; an author must never keep a second score next to the store.
- `defaults` exists only to keep the label honest: replaying a key whose value
  came from the author's fallback still reports `mode = 'default'`, instead of
  passing it off as the reader's own `saved` choice. A live answer deletes the
  mark; `reset({keys})` clears both maps.
- Display reads the resolution, never `Snowfall.get`: `get` is author `vars`
  (`0` or a grant), the outcome lives in `keys` — mixing them prints `0 live`
  next to a non-zero total.
- A store-backed HUD must be reconstructible: after a reload or a `load ↑` the
  chapters have not resolved yet this pass, so paint `keys => saved` /
  `defaults => default` from `exportJSON()` without writing anything.
- Growable chrome above the story (a breakdown line wrapping in a sticky HUD)
  shifts every anchor the engine measured once at load. Reserve one line.
- The engine's first frame can fire a snippet, so the page's functions must
  exist by then: with the page's inline script after `<script src>` and the
  document still parsing, `boot()`'s deferred `DOMContentLoaded` refresh is
  what makes that ordering safe.
- Verify an interactive page without a browser: parse the markup into a fake
  DOM, boot the real engine on it, drive `Snowfall.step(y)` at simulated
  positions and click the page's own buttons (`test/demo-game-score.js`). Model
  the document as `readyState = 'loading'` and dispatch `DOMContentLoaded`
  after the page's inline script, or the engine's first frame fires before the
  page's functions are defined.

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
- A GUI test that depends on a UI mode must set that mode itself and restore it.
  The `region` QA row reports "crop not shown" on healthy pages if it measures
  passively, because a crop is only positioned while inspect is on; it turns
  `setInspect(true)` on for the measurement and puts the checkbox back in `finally`.
  Drive the public setter — the adapter's `onInspect` callback keeps the checkbox
  honest — never dispatch synthetic events.
- Readiness and geometry must be per wagon, and every early `continue` in the
  frame pass still has to decide the crop's display: an exit that writes nothing
  leaves whatever the last pass or the host CSS left, which is a crop sitting on
  an unsized base. A fixture whose images are all `complete` never runs the
  decode-after-measure path, so it passes while a real page shows one crop out of
  four. (Skill: for anything load-driven, drive `load` events one at a time, in
  order and out of order, across a rebuild, and assert the untouched wagons.)
- Author-side fallback CSS and JS-written pixels must not fight over one
  property. `harness.css` keeps `.snow-hd img{max-height:100vh;object-fit:contain}`
  for the engine-off page; the adapter answers with a strictly more specific
  `html.snow-ready .snow-hd-live>img{max-height:none;object-fit:fill}`. The
  override wins on specificity, not on order, and `test/region.js` scans both
  texts so neither side regresses silently. (Skill: pin such pairs with a static
  scan of every selector that sets a property the JS writes.)
- **A dev page that is served over http must version every local asset.** Five
  unversioned `<script src>` tags are enough for one stale file to sit next to a
  new one, and the result is a page where every region crop is hidden with no
  error line — the "my fix did not arrive" loop. Every page now carries one
  shared `?v=N` token on `hdregion.js`, `snowfall.js`, `snowfall-region.js`
  (`index.html` also on `harness.css` / `harness.js`), bumped with every change,
  and `test/region.js` fails the build if any page's runtime tag loses it or
  disagrees with `index.html` — the demo and QA pages are served by
  `test/browser/check.js`, so a page left behind is the same half-update.
  (Skill: grep *every* page for `<(script|link)` tags without `?v=` in CI, not
  just the entry page; the token must be identical everywhere.)
- Never hide content over a metadata disagreement. An adapter-side check that
  the crop element's `src` equals `entry.hd` looked like a good guard and took
  the whole chapter's art away whenever the two strings differed for any reason
  (an escaped attribute, a stale table). A mismatch is a `console.warn` plus a
  QA row; a *missing image* is the only thing that may hide a crop. The same
  reasoning made `measure()` handshake with `hdregion.js` once (`hdUsable()`)
  instead of trusting it: a `finalLayout` that does not return the documented
  `{ok,w,h,x,y,hw,hh,hx,hy}` box now manages nothing and leaves the page to the
  author CSS, rather than writing `display:none` on everything.
  (Skill: probe a collaborator's return contract once at boot, name the file in
  the error, and degrade to the no-JS appearance.)
- **A subscriber that manages elements must also unmanage them.** The region
  adapter's `measure()` built its managed list fresh every run but only ever
  *added* `snow-hd-live` and child styles; a wagon that left the list (its
  `data-mode` flipped to `fixed`/`auto` in the editor) kept the JS cascade and
  the last frame's pixel styles inside the engine's explicit box, and `off()`
  never reached it because `off()` walks the current list. The fix is one loop
  in `measure()`: every previously managed element absent from the new list
  loses the class and its children's inline styles. Gated in `test/region.js`
  as an exclude → re-manage round trip that must repaint identically.
  (Skill: for every "adopt an element" path, write the matching "release"
  path and test the transition, not just the two steady states.)
- **Editor selection must follow every markup variant the generator emits.**
  The scene editor resolved its target with `heading.closest('section')` while
  the generator's default (`nest = both`) emits every even chapter flat, with
  the morph anchors on an `<i class="snow-fg">` carrier — half the story had a
  scene editor that showed a title and zero fields. The 0.5.0 plan had named
  the carrier as the flat-chapter target; the implementation only covered one
  of the two shapes. Flat chapters also keep their sticks as loose siblings,
  outside any `querySelector` scope of the carrier, so reading and writing
  them walks the sibling run up to the next chapter's start.
  (Skill: when a generator has N markup variants, grep the editor for the
  selector that picks the target and prove it resolves on all N.)
- **Export the API before any DOM append, and never assume `<body>`.** A story
  page may load the classic scripts from `<head>` — the engine supports that
  placement, so the adapter must too. The region adapter's boot appended its
  HUD to `document.body` (null while `<head>` parses) *before* assigning
  `window.SnowfallRegion` and binding gestures; one throw left a page whose
  crops painted but that exposed no API, no HUD and no zoom/pan, with only a
  single console line as evidence. Fix order: assign the API first, defer the
  HUD to `DOMContentLoaded` when body is absent. Gated by a fake-DOM block
  that boots with `body=null` and by a head-loaded browser scene.
  (Skill: in any script that may run during parse, everything that touches
  `document.body` goes behind a readiness check or DCL; the public surface is
  assigned before anything that can throw.)
- **Node gates certify math; only rendered pixels certify wiring.** The region
  sizing passed 2.8M fake-DOM checks while a real-browser hole (the head-load
  crash) went unseen, because the fakes never run the parse lifecycle or the
  CSS cascade. `test/browser/check.js` renders the actual scenes in Chromium
  (puppeteer + a bundled binary; self-served repo; SKIP when no toolchain) and
  compares painted `getBoundingClientRect`s with `HDRegion.finalLayout` plus
  math-free invariants (max-size fit, aspect, coverage, parked-box ==
  viewport). It runs inside `node test/run.js`.
  (Skill: keep one rendered gate in the matrix even when it has to self-skip
  on thin environments — the skip must be an explicit SKIP line, never a
  silent absence.)

## Harness demos and region integration

- Keep malformed scripts and missing-crop fixtures opt-in or local to QA. A
  normal demo should show complete pairs; otherwise whole-image fallback looks
  like a fit-math regression even when the math is correct.
- A shared base URL is valid when every use has the same rect and crop. Never
  overwrite its metadata with a missing-HD test case; use separate fixture art.
- A short wagon stack may never park. Compare child boxes in wagon-local space
  while moving, and reserve a viewport plus dwell time in normal generated
  scenes. Event QA must include the parent-bottom cap, not only chain position.
- Re-enable checks must inspect computed CSS and painted boxes, not just inline
  widths. Restoring image styles without `snow-hd-live` leaves fallback sizing
  active. Compare root classes as a set, since class insertion order can change.
- QA overlap must intersect both rectangles with the viewport; subtracting
  adjacent edges mistakes reordered, fully offscreen wagons for visible overlap.
  Story hit tests should ignore editor chrome but still catch story blockers.
  FPS is frame count divided by measured elapsed seconds, not timer ticks.

## minigames (0.4.3)

- **An extension point with one implementation per plugin wants a table, not a
  base class.** `Snowfall.use({measure, frame, off})` set the precedent, and
  `SnowfallGames.add({id, css, run, result})` follows it: no parent global to
  load first, no `new`, no `this` to thread through a runner that owns the
  session anyway, and the file still `require()`s alone under node. The test
  that a contract is the right size: after deleting every hook nothing calls,
  what is left is `run` plus one optional paint.
- **The plugin must not own the branch that the host decides.** `play()` opens
  the slot with `Snowfall.ask`, which resolves *synchronously* in replay mode;
  the runner returns false and never calls `run`, so a skip cannot paint
  controls. A game that checks `mode` itself, or paints before answering, draws
  buttons nothing can click. Same rule as the 0.4.2 `resolved` flag, moved into
  the runtime where one implementation serves every game.
- **`refresh()` silently drops pending asks** (`eventsMeasure` removes prompt
  elements and clears `pending` without resolving). Anything interactive that
  outlives it keeps its timers and its dead controls. The fix is a
  measure-only subscriber that tears live sessions down and restores the
  mount's idle markup; an on-screen anchor re-fires its own snippet inside the
  same refresh and remounts, so the reader never sees the gap.
- **`coreFrame` called `subs[i].frame` unguarded**, so a measure-only
  subscriber threw on the first frame after registering. `off` was already
  optional; `measure` and `frame` both are now. Adding a subscriber shape the
  engine cannot call is a one-word bug that only appears at runtime.
- **A mount that changes flow height shifts every anchor below it**, and the
  symptom is events firing a screen early, not a visual glitch. Reserve the
  height in the game's own wrapper (`.gamble{min-height:…}`), keep it identical
  idle/live/resolved, and compare `offsetHeight` around `run()` to warn when a
  game gets it wrong. Never `refresh()` from inside a snippet: it is reentrant
  with the fire that called it.
- **A multiplicative score has no zero.** `product(prefix)` returns 1 on an
  empty match, so clearing the save restores the base purse instead of
  emptying it — and a HUD that formats an additive total's `0` reads wrong.
  One key still holds one value, so re-answering replaces a factor; the
  invariant to assert is `store.counts.keys`, not the total.
- **A fallback binds when the slot opens.** Passing a per-page `fallback`
  after a seat already went pending (its `view` fired at load) changes nothing
  for that seat; it pays the value it was asked with. Let the game declare the
  default it is themed around, and treat the page override as per-instance.
- **The fake DOM is load-bearing, so its fidelity gaps become real bugs.** Two
  surfaced here: `innerHTML` returned only what had been *assigned*, so markup
  built by `appendChild` read back empty and the runner's idle-restore
  silently blanked a mount; and the parser dropped inter-tag text, so no
  serialized string could ever contain the words a gate greps for. Both were
  invisible until a gate asserted on the restored markup.
  (Skill: when a page gate's expectation fails, first ask whether the harness
  models the DOM behaviour the code relies on — `el.innerHTML` round-tripping
  is part of the contract, not a convenience.)
- **Give a synthetic test page a trailing spacer.** Without one the last
  anchor sits at max scroll, i.e. inside the viewport, so a "flick past
  everything" scenario fires `view` and mounts a game instead of skipping it —
  the gate then fails on a page geometry, not on the runtime.
- **An anchor inside `vh + hysteresis` of the top never re-arms.** Re-reading
  from the top only re-offers a seat whose anchor left through the bottom, so
  a re-pass can legitimately leave the first screen's seat holding its earlier
  call. Assert the store (`counts.keys`, one factor per seat), not the total,
  when testing "overwrite, never stack".

## review pass after 0.4.3 — idempotence, prose, save identity

- **A `view` re-fires; a second `ask` for a pending key is silently ignored;
  the caller cannot tell the two apart.** Scroll a live game's trigger out
  below the window and back in: the anchor re-arms (that is the documented
  events contract), the snippet calls `play()` again, `ask` warns and returns
  nothing, and the runner — which cannot see that its ask was refused —
  painted a second game over the first. The first mount's buttons then
  answered a slot the runner no longer tracked and `refresh()` left the
  second mount's DOM behind. Any layer that turns `ask` into a session must
  own idempotence per key itself: `play()` now looks up its own `live` list
  and returns `true` untouched for a key that is still on screen.
  (Skill: when an engine primitive deliberately returns nothing, every caller
  that keeps state around it needs its own "already open" check, and the gate
  for it is the enter → leave → re-enter scroll, not a single fire.)
- **A layout newline inside prose is a text edit.** The source serializer
  indented every element child on its own line, so `<p>Hello <em>world</em>!</p>`
  came back as `Hello \n\t\t<em>world</em>!\n\t` after one inspector edit —
  and grew again on each of the following ones, since every `mutatePreview`
  re-serializes the page. The generator never emits text next to an inline
  element, so the round-trip QA was blind to it; only hand-written author
  markup showed it. A node with real text among its children (or `pre`,
  `textarea`) is now written inline, verbatim, and the browser gate feeds the
  editor a mixed paragraph and expects it back byte-identical after two
  round trips.
  (Skill: a "round-trip stable" claim about a serializer is only as strong
  as the corpus it was checked with — include the shapes the generator
  cannot produce, especially mixed content.)
- **`story`/`slot` in a save file are an address, not content.** `importJSON`
  and the boot-time load adopted them from the parsed document, so importing
  a file exported by another page redirected every later autosave to
  `snowfall:<other>:<n>` — a key this page never reads on the next visit,
  which looks like "the save vanished". The page's own id (from
  `data-story`/`<meta name=story>`/the path) now stays put; a mismatching
  import warns and loads into this page's slot. `Snowfall.store` exposes
  `story` and `slot` so the harness names its download after the real id.
- **A dead parameter in the hot loop is a review finding, not a nit.**
  `stickyShown` took `pH` and the measure kept a whole `Float64Array` of
  parent content heights for it, plus a `lastMl` cache that was reset to NaN
  at the end of the same measure that filled it — every read cost per frame,
  no effect. Removed, with the test callers; `node test/math.js` is the
  guard for the arity.
- **Running the browser gate in a sandbox**: `npm i puppeteer-core@23
  @sparticuz/chromium@131` in `/tmp/browsertest`, `executablePath()` extracts
  `/tmp/chromium`, and its NSS/NSPR libs come from `bin/al2023.tar.br`
  (brotli → tar → `lib/`) on `LD_LIBRARY_PATH` (`/tmp/al2023/x/lib` is where
  `check.js` looks). `require('puppeteer')` is satisfied by a two-line
  `node_modules/puppeteer/index.js` that re-exports `puppeteer-core`.

## paged mode (0.6.0)

- **Measure the box the controller is about to change, with the controller
  off.** The walk ends at the story root's bottom edge, and the root's
  `getBoundingClientRect()` is the clamp's own output. Reading it while
  `height` was applied fed the boundary list into itself: the story shrank a
  little on every `refresh()` and never stopped. `measure()` unapplies first,
  reads, walks, reapplies. The general form — *any measurement of a
  container whose height you are deriving from its content's positions must
  happen in the un-clamped state.*
- **A "pending boundary" that is never cleared after the commit makes the
  stop walk non-deterministic.** The first version kept `pending` after
  `commit()`, so the next element with content re-committed the *previous*
  stop's Y with a new element label. Symptoms: a boundary count that wobbled
  11 → 10 → 9 between runs, and mislabelled boundaries (`EM`, `H2`, `OUTPUT`
  showing up as stops). Two rules together fix it: a non-stop returns before
  touching `pending`, and `pending = null` immediately after every commit.
  (Skill: a one-element lookahead is a state machine; write down when the
  state is cleared, not only when it is set.)
- **`stopY()` returning null must not clear the pending slot.** A `return`
  from the middle of a helper that was also responsible for resetting the
  walk state silently reset it on the *no text* path, which is the path every
  `<br>`-only paragraph takes. Keep the walk's mutable state in the walk.
- **Growing a `Float64Array` of results by reallocating zeroes what was
  already written.** `P.y = new Float64Array((n + 1) * 2)` is correct on a
  steady-state page and wrong on the first walk that outgrows its initial
  capacity — invisible in a browser, where a second walk rewrites every
  slot, and a total loss of the page list in node, where the fake page is
  measured once. `grow(need)` now copies. Same trap in any paged buffer.
- **A stop's portion is only a page if it has content.** Empty `<p>`, the
  first of two `<br>`, a trailing `<br>` before `</p>`, a `<section>` that
  opens straight into its first `<p>`, and a blank opening page (a stop at
  the very top) are all one page, not five. The rule is "commit a pending
  stop only when text is found, then merge anything within a pixel". A wagon
  (`.snow-bg`) counts as content — a picture-only portion is a real page —
  which is why a section that opens with a picture keeps its boundary while
  an empty one merges away.
- **A `<br>` rect is not a line.** Its bottom is the content-area bottom, so
  a boundary there shows the next line's half-leading. `Range` from the last
  glyph before to the first glyph after, and take the midpoint: the browser
  gate asserts the boundary is *strictly* inside the gap on both sides, which
  is what makes the rule font-independent.
- **Mark subtrees the engine owns.** A `.seat` div is a paragraph before
  `SnowfallGames.play()` mounts and a game box after; adding `data-nopage`
  keeps it out of the stop list in both states, so the page count cannot
  change under a refresh. (Without it the page count wobbled by one and it
  looked exactly like a measurement-feedback bug.)
- **The page is kept by element, not index, and every path that moves the
  index must set it.** `next()` and `prev()` updated `k` but not `kEl`, so a
  source edit (the QA page's daily case) put the reader one page back. A
  single `P.k = i` is a bug factory; `P.kEl = P.el[i]` next to it is the
  contract.
- **`prev()` cannot shrink before the scroll.** `scrollTo({behavior:'smooth'})`
  plus a shorter document makes the browser clamp the scroll on the spot and
  the page jumps. The height lands in a frame callback keyed on arrival —
  one compare per frame, no listener, no rAF of its own.
- **Full-window wagons back to back leave a one-pixel parking band.** With
  `chain()`, a middle wagon is at `top: 0` only where `free[i] <= 0` *and*
  `pos[i+1] − ext[i] >= 0`; with three 800px wagons that is a band about a
  pixel wide, and Chromium's integer scroll lands at its edge (`pos −0.28`).
  Gate it by scanning the allowed scroll range for `min|pos|`, not by
  asserting `pos === 0` on a layout that never produces it.
- **The fake DOM's parser left markup in the text stream.** `last` advanced
  only in the `<script>`/`<style>` branch, so every inter-tag slice carried
  the previous tag's source: a `<p></p>` was not empty (its "text" was
  `"<p>"`), so an empty paragraph counted as content and every merge test
  was wrong by one page. Existing gates never noticed because a stray text
  node has zero height. (Skill: a fidelity gap in a shared fake is a finding
  for *every* gate using it, not just the one that tripped over it.)
- **A fake page is laid out once.** To test "an edit above the reader keeps
  the page", the gate has to reflow by hand: shift every descendant at or
  below the insertion *except the root itself* (the story root's box never
  moves) and grow its `_h`. Moving the root too makes the controller
  correctly report a blank opening page, which is a fine behaviour and a
  useless fixture.
- **`page.evaluate` callbacks are their own realm.** A `const TOL = 1.5` from
  the gate module is a `ReferenceError` inside the page; pass tolerances as
  arguments. Same for injected helper strings: a `function` declaration in a
  string that is evaluated as an expression is not in scope for the object
  literal that references it.

- **To put a page's own start at the window's top, the document needs room
  the page does not use — and a bottom margin is the only thing that gives
  it without painting or touching the DOM.** A portion shorter than the
  window cannot scroll to its own start: the document ends at the boundary.
  Padding on the root is inside `overflow: clip`, so it would paint the
  unrevealed text it is meant to hide; a spacer element is a DOM mutation the
  controller does not do; a `translateY` moves the sticky scrollport and
  breaks wagon parking; a negative top margin moves every anchor and forces
  a `refresh()` per turn. Measured in Chromium: `margin-bottom` on the last
  in-flow child *does* extend the scrollable area (doc height grew by
  exactly the margin), the margin area paints the page background with no
  story content in it, and `elementFromPoint` there returns `HTML`, not a
  paragraph. Skill: *when a clip has to hide one side of a box, the other
  side's space has to come from outside the clip.*
- **Bottom-aligning a page is not "revealing a page".** The first version of
  this mode clamped the root at the next stop and scrolled to the new
  maximum, which put the boundary on the window's bottom edge — and therefore
  left a windowful of already-read text on every page after the first. The
  symptom looked like a feature ("text appears a bit at a time") and was the
  opposite of the mode. When a reading mode has a position for the *new*
  material, ask which edge the old material ends up behind.
- **A step cap below one viewport makes every page turn two taps.** With
  top-anchored pages, consecutive page starts are a full window apart, so
  `stepMax = 0.9` meant: tap, move 0.9 of a window, tap again, arrive. The
  cap exists to stop a jump from skipping an anchor, and a page turn is
  provably never longer than a window (the reader is at the old page's spot;
  the new page starts at most a window below), so `stepMax = 1` keeps the
  guarantee *and* the one-tap turn. Skill: *check whether the cap is ever
  the binding constraint before tuning it down; a cap that binds on the
  common path is a bug wearing a safety hat.*
- **A full-window art wagon is sliced by a page shorter than the window.**
  The engine parks a `.snow-bg` at the window's top, and the page's clip ends
  at its own boundary, so a short page cuts the cover in half with body
  background below. Nothing in the controller can fix it without showing more
  text than the author's stop — it is a page-rhythm rule: *a chapter with
  full-window art wants full-window pages.* The demo teaches it by writing
  its art chapters as full-window pages (cover, chapter card, full-window
  paragraphs) and keeping a text-only chapter with genuinely short pages,
  and the browser gate asserts that no wagon box straddles a page edge.
- **Assert the model, not the boxes of the elements that happen to make it
  up.** "Which portion is on the page" cannot be checked with
  `getBoundingClientRect()` of the stop elements: a container legitimately
  spans the page (its top is above the window when the page starts mid
  paragraph), and the last boundary's element is the story root itself, 8000
  pixels up. The assertions that mean something are geometric —
  `scrollY − start(k) ≥ 0`, `|scrollY − spot(k)| ≤ 1.5`, `scrollHeight ==
  round(y[k] + band(k))` — plus one paint-level check,
  `elementFromPoint` outside the story root under a short page, which
  distinguishes blank paper from text no amount of arithmetic can.
- **A minigame seats itself the first time it is looked at, and the panel it
  paints changes the height of the story below it.** A self-test that compared
  engine anchors "before" and "after" a walk failed by 81px — exactly the
  seat's growth — and the controller was innocent. Two `refresh()` calls at the
  same scroll settle it (the first rebuilds, the second measures the rebuilt
  layout); the same trick is the right answer anywhere a check reads a
  measurement that content it does not control can still be changing.

## paged mode — the story that changes its own height (0.7 fix pass)

- **A gate that asserts the model against itself cannot see the model drift
  from the document.** The paged gates compared `scrollY` against the
  controller's own `y` list — perfectly green while the reader sat 163px off
  the real stop, because the reader and the stale list agreed with each
  other. Every step needs at least one assertion against ground the
  controller does not produce: at an arrival, the window top must equal the
  page's own stop element's measured `getBoundingClientRect().top`.
- **A height clamp hides inner layout changes from every document-level
  signal.** With `height` pinned on the story root, a minigame seating
  itself inside it changes neither `scrollHeight` nor any doc-level
  observable — the only witnesses are the elements' own rects, and only
  when the clamp is off. So "compare scrollHeight to detect drift" is
  blind exactly when it matters; watch the subtree (childList) instead, and
  re-measure with the clamp off.
- **Subscribers measure in registration order; a subscriber that mutates
  the tree in its own `measure` (games `dropAll`) poisons every list
  measured before it in the same refresh.** The paged controller measured
  first, the games runner unmounted its sessions after — so every
  game-dropping refresh left the boundary list one tick stale, and a
  synchronous walk could never see the correction. The fix is not an
  ordering rule but a policy: measure at the moment of use (every turn,
  every toggle), and let the observer's tick cover the parked reader.
- **Scroll anchoring cancels a travelling programmatic smooth scroll.** A
  game unmounting above the viewport mid-glide makes the browser compensate
  scrollY, and the compensation kills the animation — a controller waiting
  for "arrival" to apply a deferred correction waits forever, one page
  behind. Never wait for your own smooth scroll to arrive to correct
  state; re-target it (a second `scrollTo` restarts the glide from the
  current position).
- **`P.k = i` without `P.kEl = P.el[i]` is a bug factory — and "every
  path" means every branch.** `prev()`'s smooth branch decremented `k`
  alone; it was harmless while `measure()` only ran on engine refresh, and
  became an infinite loop the day a turn re-measured (the measure restored
  the page from the stale element, the decrement never stuck, `while
  (prev())` never ended). The rule has to be checked per branch, not per
  function.
- **A synchronous QA walk cannot see anything that lives on a timer.** The
  demo's self-test walked pages in one JS task: no microtask checkpoints,
  no timers — so an observer-scheduled re-measure never ran between taps
  and the walk "passed" on a reader path no human experiences. A walk that
  claims to prove reader-visible behaviour must `await` a tick per step.
- **Puppeteer/Chromium in a locked-down sandbox**: `npm i puppeteer` pulls
  the browser through the npm proxy, but `~/.cache` does not survive
  between commands — extract a chromium once (e.g. `@sparticuz/chromium`'s
  `.br` archives: binary + `al2023.tar.br` libs + fonts) into `/tmp`, point
  `CHROME_PATH`/`LD_LIBRARY_PATH`/`FONTCONFIG_PATH` at it, and the repo's
  own `test/browser/check.js` runs unmodified.
- **The clamp-off measure drops the reader's scroll — synchronously.**
  `measure()` must read the root unclamped, and with the paper gone the
  browser clamps `scrollY` to the shorter document's end in the same task.
  A controller that measures per tap then compares the *post-measure* scroll
  against the page's done spot hurries ground it already passed — an
  infinite `next()` loop that only ends in an OOM'd renderer. Take the
  scroll before the clamp comes off and put it back after; the window never
  paints the drop.
- **A glide in flight is already committed to its target.** A tight
  `while (P.next());` reads `scrollY` mid-animation every call and
  re-hurries a position the glide has left, thousands of times a frame.
  The hurry check must compare against the scroll the page is *heading to*
  (`P.going`) when one is set: then the loop advances one band a call, and
  a human's fast double-tap turns instead of re-hurrying a finished page.
- **The screenful rule is greedy on purpose.** "The page ends at the last
  stop that fits" leaves a bounded blank band before a portion too tall for
  the remainder; a best-fit/argmin grouping pulls that portion up instead
  and buries its neighbors, which reads as skipping. Choose the literal
  rule; the blank is a preview of what comes next.
- **`min-height` boxes around single paragraphs fight the grouper.** A
  paragraph styled to the band *is* one portion per page — the screenful
  rule correctly returns one-portion pages, and the page looks like a
  caption on blank paper. Fill screens are several short paragraphs; the
  grouper packs them. (The look you want comes from the author's rhythm,
  not from CSS boxes.)
- **Cover wagons are window-tall by engine contract.** With top chrome the
  reading band is shorter than the art, so a page cut at the band leaves
  every cover sliced at its bottom edge. Size the cover's own portion (the
  card) to the full window instead: the page becomes the art exactly, is
  walked like any tall portion, and nothing is cut.
- **Fakedom proportions decide what a test can prove.** Portions of a
  quarter screen pack four to a page; a walk that expects one page per tap
  then stalls on page 0 and every per-page assertion fails misleadingly.
  Multi-page fixtures need portions over half a band.
