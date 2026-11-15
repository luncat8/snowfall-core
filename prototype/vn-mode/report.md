I'll start by looking at the repo to understand the current engine and where the VN-mode decision was left.

Now variant C (ink: pages, lines appear in place).

The prototypes are built: five separate pages on one shared test story, each with a book ⇄ VN switch, in `prototype/vn-mode/`. The live preview opens on the index that links them (it also works from `file://`).

Wagon pushing, sequential scripts and the theme transition work in both modes in all five. No variant re-implements the push: each keeps a real scroll position and moves it, so the engine's own chain runs, forwards and backwards.

| Variant | Idea | One step | Scripts fire | Main cost |
|---|---|---|---|---|
| **A · film** | Blank spacers pad the story into whole screens; a step scrolls one screen | a page | when the page arrives | spacer nodes in the DOM |
| **B · feed** | The book's own layout; a step scrolls the next portion's end onto a fold line, later text is invisible | a portion | per line | a new picture climbs in over several steps (an option gives each cover picture its own screen) |
| **C · ink** | A's screens, but lines appear in place; a full page turns with a push; optional typewriter | a portion | per line | the `parked` event fires as `view` |
| **D · box** | The page is a picture stage; a box shows a copy of the current portion | a portion | per line | text leaves its picture and exists twice; `parked` fires as `view` |
| **E · clamp** | Today's `snowfall-paged.js`, as the baseline | a page | by scroll | pages are not whole screens, so a cover picture is cut by a short page |

A–D can also switch between two ways of removing the scroll: the window locked with the controller scrolling it, or a fixed stage where the window never scrolls at all.

Each page has a self-test button that walks the story both ways and can save a report, plus a live script log that flags anything out of order. I ran these in headless Chromium at desktop and phone sizes with both scroll options, and all pass. I also checked real key, tap and wheel input, mid-animation pushes, the theme morph, resize, and a screenshot diff confirming unread text is not painted in B and C.

Things to know before you compare:

- **Smoothness is not judged.** The sandbox renders in software; only the first page turn in A stuttered there, which looks like a sandbox artefact, but check it on a real machine.
- **B and C need the CSS Custom Highlight API** (to my knowledge Chrome/Edge 105+, Safari 17.2+, Firefox 140+). I only tested Chromium; Firefox may not draw the readability halo on read text.
- **Engine quirks found along the way** (not fixed, engine untouched):
  - A `.snow-bg` without an explicit `data-mode="cover"` is not painted as cover.
  - Loose text after a `</p>` joins that paragraph's portion.
  - In E, switching to book and back lands one page further on.
- **The story's chapters are deliberately longer than a screen.** Pictures closer than one picture-height push each other before parking and run ahead of their text.

`README.md` in the folder lists what each variant would need from the engine. I also added a section to `findings-pitfalls-skills.md`. The work is committed locally and not pushed.

Which variant should become the real VN mode?