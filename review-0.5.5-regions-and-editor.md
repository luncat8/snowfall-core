# Review — 0.5.5 region backgrounds × display modes, and editor sync

Scope: architecture review of the 0.5.5 region feature (`hdregion.js`,
`snowfall-region.js`, engine contract), how it interacts with the wagon
display modes (`cover/contain/tiled/fixed/auto`) and exit `data-dir`, and the
harness editor's sync to the current background and scene. Findings are
marked **fixed** (changed in this branch + gated) or **open** (documented,
not changed), with evidence.

## 1 · The one vocabulary problem: three different "modes"

The suspicion that "region vs view modes" is muddled is correct — but the
math underneath is not. There are three mode systems that sound alike and
govern different things:

| system | values | who reads it | effect on a `.snow-hd` wagon |
|---|---|---|---|
| `data-mode` (engine, `snowfall.js:323`) | cover / contain / tiled / fixed / auto | engine sizing + CSS `background-*` rules (`snowfall.js:171-175`) | **only fixed/auto matter**: they give the wagon an explicit centred box and are excluded from region management. cover/contain/tiled are no-ops — the adapter frames the picture regardless |
| region fit (`hdregion.js`) | one rule, no options: `s0 = min(vw/rw, vh/rh)` | `finalLayout` | the crop's rect decides the scale ("fit", never cover); a whole-base wagon is **contained and centred**, letterbox bands included — deliberately *not* cover |
| `data-dir` (exit direction) | top / left / right / bottom | `wagonsFrame` exit projection | composes rigidly with region children (they ride the wagon transform); gestures still target entering/exiting wagons via `pickTarget` — by design |

Consequences that read like bugs but are contract:

- On a region wagon, the inspector's `display mode` select only has two
  meaningful values (fixed/auto = "stop managing me"). cover/contain/tiled
  change nothing visually. **Open**: the select should say so (disable or
  annotate it for `.snow-hd`), otherwise users will report "mode is broken
  on region backgrounds".
- A region wagon whose base can't cover the window shows page background
  above/below. That is the reference's fit, gated as invariant I4; it is not
  a missing `cover`.

## 2 · What is genuinely solid

- **Single authority for the math.** `hdregion.js` is DOM-free, the adapter
  never re-derives fit/clamp/pivot, `finalLayout` canonicalizes `view`
  in place (one clamp authority, idempotent frames), and the pinned
  reference implementation is compared at 1e-6 on its own scenes plus 60k
  fuzzed layouts (`test/region-parity.js`), with 200k more invariant checks
  in `test/region.js`. The two historical defects (the `min(cover, room)`
  shrink-ray; the `max()` cover exception for whole bases; raw box position
  as "untouched" state) are all fixed *and gated* — this is the part of the
  codebase where "wrong architecture" was already repaired properly.
- **Engine 0.5.5 contract** is present and consistent: cached
  `clientWidth`-first viewport, `Snowfall.viewport` getter, `step()` reusing
  the cache, and the parent-bottom `pos` clamp (`snowfall.js`, wagon frame),
  each pinned by a static scan or node simulation in `test/region.js`.
- **Degradation ladder** (no entry → whole base; entry without `hd` → whole
  base + hidden crop; undecoded crop → hidden; stale `hdregion.js` → plain
  backgrounds, named error) is coherent and probe-checked.

## 3 · Confirmed bugs (fixed in this branch)

### 3.1 A wagon that drops out of region management kept the JS paint — fixed

`measure()` skipped `fixed`/`auto`/`data-static` wagons when building the
managed list but never cleaned up wagons that *leave* the list. So the
moment the editor (or an `applySource` of hand-edited markup) switched a
parked region wagon's `data-mode` to `fixed`/`auto`, the wagon kept
`snow-hd-live` (the absolute-positioning cascade) **and** the last frame's
pixel `width/height/transform` on both `<img>` — now inside the engine's
small explicit box. `off()` never reached it either (it only walks the
current list), so even disabling the engine left the mess.

Fix: `measure()` now returns every previously managed wagon that is no
longer in the list to the author rules (class removed, child styles
cleared) — `snowfall-region.js:154`. Re-managing later repaints from the
NaN-invalidated write gates, and the WeakMap view survives the round trip.
Gated in `test/region.js` (6 new assertions, all green). This makes the
authoring contract ("on fixed/auto the adapter warns and leaves the wagon
alone") actually true under the editor, not just on fresh pages.

### 3.2 Scene editor silently empty on every flat chapter — fixed

The 0.5.0 plan specifies scene fields bound to the `<section>` **or, for
flat chapters, to the `<i class="snow-fg">` carrier**. The implementation
only did `heading.closest('section')`, so flat chapters had a scene editor
that showed a title and zero fields. With the default `nest = both`, that
is every even chapter — half the story's page-color/style/range/stick
editing was dead, exactly the "feature has bugs" symptom.

Fix: `sceneTarget()` (`harness.js:526`) falls back to the carrier
preceding the chapter head; `flatRun()`/`chapterStick()` make the stick
fields read/write the loose siblings of a flat chapter (a section-scoped
`querySelector` cannot reach them). Morph edits land on the carrier, which
`styleMeasure` already collects.

### 3.3 Preview→source sync skipped a chapter whose heading sits on line 0 — fixed

`syncPreviewToSource` used `!lines[i]` as the "no line" test, so a heading
on line 0 of the source (legal in hand-edited flat markup) was treated as
missing and sync silently stopped. Now `lines[i] === undefined`
(`harness.js:696`).

## 4 · Editor sync to current background/section — remaining gaps (open)

Selection itself matches the 0.5.0 plan and is sound: parked wagon
(`pos==0 && free<=0`, last wins), else last anchor above the reading line,
else wagon 0; engine absent → nearest rect. The 10 Hz tick, the
focused-input guard, and the `mutatePreview → refresh → re-serialize` loop
are all per spec. Known gaps:

1. **Editing a region wagon's image URL breaks its region binding,
   silently.** `applyInspector` rewrites the base `<img src>`; `REGIONS` is
   keyed by the old src, so the wagon falls down the "no entry" ladder
   (whole-base framing, crop hidden). That degradation is the documented one
   for unknown URLs, so nothing *crashes* — but the old crop `<img>` stays
   in the DOM, the orphaned entry leaks into `save regions.js`, and the user
   gets no feedback that they just detached the crop. Recommended: disable
   the `image URL` field for `.snow-hd` wagons, or re-key the entry and drop
   its `hd` (the crop can't follow a new base). Not changed here because the
   correct UX choice is a product decision.
2. **`size` field on non-fixed/auto wagons does nothing** — the engine reads
   `data-size` only for the explicit-box modes. Harmless, but the field
   invites confusion; hide it unless mode is fixed/auto.
3. **Scene and background selection can point at different chapters** during
   a push transition (heading at the reading line vs parked wagon).
   Intrinsic to the two definitions; worth a one-line hint in the panel.
4. **Style-less flat chapters have no carrier** → scene editor still empty
   there (nothing to edit — morph is off for that chapter anyway).
5. Source↔preview scroll sync is chapter-granular by design (0.5.1 plan),
   with the 18 px line arithmetic matching the fixed `12px/18px` `#src`
   font. Fragility to know: `headLines()`/`chapters()` are paired by index,
   so hand-edited source with a missing or extra `h4.n` shifts the mapping
   for all later chapters.

## 5 · Smaller observations

- `index.html` exit select: `<option value="none" selected>top</option>`
  plus a second `top` option produced identical output; the label/value
  mismatch ("none" displays as "top") was confusing. **Fixed in the leftover
  pass (§10)**: one `top` option, presets and the QA hash say `top`.
- With `regions` on, the generator coerced fixed/auto → cover but still
  emitted `tiled`/`contain` on `.snow-hd` wagons in mixed mode — a visual
  no-op (see §1). **Fixed in the leftover pass (§10)**: a `.snow-hd` wagon is
  emitted as `cover`, the one value the adapter obeys.
- `applySource` intentionally does not regenerate `REGIONS` (keys are stable
  data-URIs / book paths); pasted new URLs correctly land on the no-entry
  ladder.
- The adapter's write gates compare with 1/100 px tolerance because a
  persisted pan round-trips through `rest + pan` at a few ulps — documented
  in code, and NaN doubles as the repaint sentinel. Not a smell; noting it
  because it looks like one on first read.

## 6 · Round 2 — rendered-pixel proof and the head-load crash

The round-1 review proved the math in node fakes; the user was right that
that is not the same as proving the page. This branch now renders.

**Tooling.** The sandbox egress allows npm but no Chrome CDN, so the browser
gate uses `@sparticuz/chromium`'s bundled binary (`/tmp/chromium`) plus the
NSS/NSPR libs shipped inside its `al2023.tar.br` on `LD_LIBRARY_PATH`.
`test/browser/check.js` resolves whatever is available, self-serves the repo
on an ephemeral port, and prints `SKIP` (exit 0) when no browser exists, so
`node test/run.js` includes it unconditionally.

**The two scenes the request names, painted at 1440×900:**

- Scene 1 (one `data-mode="cover"` wagon, real book files `img/1.avif` +
  `img/1_c.avif`, rect 477,239,804,1056): parked wagon box = viewport; crop
  painted **685.2×900 at (377.4, 0)** — `s = min(1440/804, 900/1056) = 0.8523`,
  i.e. the HD-region reference rule "region fitted at max size, aspect kept,
  touches the window on its limiting axis"; base 1636.4×1309.1 covers.
- Scene 2 (two wagons, screen flow): wagon 1 parked paints **identically** to
  scene 1; scrolling until wagon 2 parks (`img/3`, rect 476,101,1016,900)
  paints its crop at **1016×900** (s = 1.0), and wagon 1 keeps its size while
  pushed off. 44/44 checks green, plus 44/44 on the live harness generator
  (generated art and `realScenes`, all three rotation cases: full entry,
  entry without `hd`, no entry).

**The real bug round 2 surfaced — fixed and gated.** Loading the classic
scripts from `<head>` (a legal placement the engine itself supports) runs the
adapter while `document.body` is still null: `buildHud()`'s `appendChild`
threw *before* `global.SnowfallRegion = api` and the gesture listeners, so a
head-loaded page painted its crops but exposed no API, no HUD and no
zoom/pan at all — exactly the class of "feature is broken" report that node
fakes can never see. Fix (`snowfall-region.js`): export the API first, defer
the HUD to `DOMContentLoaded` when `body` is absent. Gated twice: a fake-DOM
block in `test/region.js` (boot with `body=null` must not throw, API and
export survive, HUD appends once body arrives) and `scene1-head.html` in the
browser gate (identical painted geometry to the body-loaded page).

## 7 · Changes in this branch (cumulative)

| file | change |
|---|---|
| `snowfall-region.js` | unmanage dropped wagons (§3.1); API exported before boot, HUD deferred to DOMContentLoaded for head-loaded pages (§6) |
| `harness.js` | `sceneTarget`/`flatRun`/`chapterStick` for flat-chapter scene editing (§3.2); `lines[i] === undefined` (§3.3) |
| `test/region.js` | exclude/re-manage gate (§3.1); head-load boot gate (§6) |
| `test/browser/` | new: scene1/scene2/scene1-head pages + self-contained `check.js` rendered-pixel gate, wired into `test/run.js` (§6) |
| `test/run.js` | includes the browser gate; SKIPs without a toolchain |
| `index.html` | shared `?v=` token, one value on every page (15 at the end of the branch) |

`node test/run.js`: all 5 gates green (math 1781, region-art 1206,
region-parity 64 684, region 2 813 585 by the end of the branch, browser 44
rendered checks).

## 8 · Verdict

The region **math and engine contract are well-architected** and now proven
at three levels: node fuzz/parity, fake-DOM integration, and rendered pixels
in a real Chromium (44 checks per scene set, plus the harness generator).
The defects were all at integration seams: adapter lifecycle vs editor
mutations (§3.1), editor selection vs flat markup (§3.2), source-sync edge
(§3.3), and boot ordering vs legal-but-early script placement (§6). §3 and §6
are fixed and double-gated; §4.1 (region source edit in the inspector) still
needs a product decision.

## 9 · Round 3 — user-facing cover pages, verified with real rendered pixels

Two standalone pages the user can open directly (work from `file://`, zero
network): `region-cover-1.html` (one `.snow-hd` wagon, `data-mode="cover"`)
and `region-cover-2.html` (same scene as page 1 + a second scene with a
different rect/palette). The art is generated for the eye: the base is a
**blurred** coordinate grid (labeled every 200 px) with a dashed region
outline; the crop is the **sharp** vector twin of exactly that rect, 1:1 with
it (the material rule), drawn in the base's coordinate space (its `viewBox`
is the region rect). A correct layout therefore shows the sharp grid
continuing the blurred grid with zero offset and the crop frame lying on the
dashed outline — any misplacement is visible at a glance, not only in
numbers. Each page carries a panel that compares the painted rects against
`HDRegion.finalLayout` and, independently, against the pinned reference's
fit+clamp math (`hdregion.js` @ luncat8/HD-region@1a89bb7).

Verified in the round-2 Chromium toolchain (rendered pixels, 1440×900):

- page 1 parked: crop **1350×900 @ (45,0)** (max fit, touches the height
  axis, aspect 1.5 kept), base **2400×1500** covering the window, crop
  exactly on its region of the base, reference parity 1e-9 — 12/12 rows PASS.
- page 2: after #2 parks, #2's crop **1440×810 @ (0,45)** (touches the width
  axis) with all reference rows PASS, and #1's children **byte-identical** to
  its parked snapshot (`2400px|1500px|translate(-555px,-300px)`,
  `1350px|900px|translate(45px,0px)`) while the wagon is pushed rigidly
  above the viewport (dy = −900) — it keeps its proper size.
- resize to 390×844 re-fits: crop 390×260 centred; the base (693×433) cannot
  reach the window height, so the reference's centre rule applies — both
  implementations agree there.
- screenshots of both parked states confirm the grid/frame alignment by eye;
  `node test/run.js` now runs 5 gates green (4 node + the 44-check rendered
  browser gate).

The crop art is a vector SVG: the layout math never reads the crop's natural
size (it only gates on `naturalWidth > 0`), so the fit comes purely from the
entry rect while the crop stays visibly sharper than the blurred base —
"hi-res vs low-res" without changing the contract. Its intrinsic size is still
1:1 with the rect, the same rule a real `_c.avif` follows (§ material rule), so
no page teaches a density the pipeline does not use.

## 10 · Leftover pass over the branch delta

A read-through of the whole `278b8f..HEAD` delta for dead code, stale comments
and non-optimal bits. Fixed here:

- **Dead code.** `parseT()` (unused since the tolerant-transform experiments)
  and the orphaned `hyst` in `harness.js` (the check that consumed
  `vh + hyst` was replaced by the parent-cap arithmetic) — removed.
  `window.SCENE_META` in `region-cover-1.html` had no reader either, and the
  test files carried two more: `near()` in `test/math.js` and the
  `LATE_WHOLE` layout in `test/region.js` — the latter's assertion ("an
  absent rect is the whole base, not a rect at the origin") is written where
  it belongs now, in the fake-DOM integration block. A dead-function and
  dead-binding scan over every `.js` in the repo is clean after this.
- **A false error line.** `snowfall-region.js` reported "hdregion.js does not
  satisfy finalLayout(…)" when the file was `require()`-d under node with no
  document. A browser-less load is not a broken contract; the contract break
  is still named when the math file is really the one failing. Gated by a
  no-document block in `test/region.js`.
- **Indentation.** The `overflow:clip` comment and `var CSS` block in
  `snowfall.js` sat one tab deeper than every sibling top-level statement.
- **Version tokens.** `region-cover-1/2.html` and the three `test/browser`
  pages still said `?v=12` while `index.html` said `?v=15`, and the static
  gate scanned `index.html` only. All pages now share one token, and the gate
  checks every page for the token *and* for load order
  (`regions.js → hdregion.js → snowfall.js → adapter/harness`).
- **Comments that were not true.** The three demo pages called their inline
  oracle a "verbatim copy of hdregion.js" (it is the reference's two layout
  functions, reduced), and they drew and announced a "2×" crop — the density
  the material rule rejects. Both corrected to 1:1.
- **Honesty of the generated markup.** A `.snow-hd` wagon is emitted as
  `data-mode="cover"`, the one value the adapter obeys (§5).
- **Line references** in this document became symbol names: `file:line` rots
  with every edit, and several of them were already pointing at the wrong
  line.

Open, reported rather than changed — the branch disagrees with itself about
`tools/*.py`. `findings-pitfalls-skills.md` says they were vendored on purpose
("Vendored the four example files and the four tools so the repo can both show
and produce real scenes"), while the plan's non-goals and owner table put the
asset pipeline in HD-region ("No asset pipeline here"; `tools/*.py` → HD-region,
runtime JS vendored one-way *from* this repo). Their docstrings cite
`archive/plan-tools.md` / `archive/plan-storage.md`, which exist in the asset
repo, not here. Either the tools stay (then the plan's rows should say so, and
the doc pointers should resolve here) or they leave (then the findings line
should drop them) — a product/ownership call, not a code fix.
