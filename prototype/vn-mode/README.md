# VN mode prototypes

Five standalone pages that answer one question differently: **when the reader does not
scroll and everything sits on one screen, what drives the wagons, the theme and the
scripts?** Open `index.html` (works from `file://`).

All five run the same story (`story.js`) on the unchanged engine (`snowfall.js`), take
the author's stops from the unchanged `snowfall-paged.js` walk, and keep the book: every
page has a book ⇄ VN switch that holds the reader's place.

| page | idea | one step | scripts fire |
|---|---|---|---|
| `vn-a-film.html` | spacers pad the story into whole screens; a step scrolls one screen | a page | when the page arrives |
| `vn-b-feed.html` | the book's own layout; a step scrolls the next portion's end onto a fold, later text has no ink | a portion | when the line crosses the fold |
| `vn-c-ink.html` | A's screens; lines get ink in place, a full page turns | a portion | when the line gets ink |
| `vn-d-box.html` | the page is a picture stage; a box shows a copy of the portion | a portion | per portion |
| `vn-e-clamp.html` | baseline: today's `SnowfallPaged` height clamp | a page | by scroll |

A–D also run with either scroll driver (toolbar, or `?driver=stage`):

- **window, locked** — the window stays the scrollport, `overflow:hidden` locks the reader
  out, the controller scrolls it.
- **stage** — the window never scrolls; a fixed stage element is the scrollport.

`?mode=book` opens a page as a book.

## What stays true in every variant

The wagon push is never re-implemented. Every variant keeps a real scroll position and
moves it; the engine's chain, sticky parking, exits, theme morph and event edges run as
they do in the book. That is why the push works both ways and in both modes, and why
going back is free. The variants differ only in:

1. **what the document looks like** (book layout, or padded into screens),
2. **where a step lands** (a page, or a portion),
3. **what the event pass is told the position is** (the scroll, or the reading position),
4. **how unread text is kept off the screen** (it is below the window, or it has no ink).

## Trade-offs

**A · film.** Simplest to reason about: after the spacers are in, VN mode is "scroll by
one screen". Pictures are always whole at rest. A page of text shows at once, so scripts
on a page fire together when it arrives. Costs DOM nodes (two spacers per page edge) and
a relayout on resize.

**B · feed.** No layout change at all, so a picture sits on exactly the text it sits on in
the book, and the push is the book's push in small steps. Scripts and theme are read at
the fold, so they fire a line at a time. A new picture climbs in over several steps;
"pictures: one step each" gives each cover picture a screen of flow (the engine's own
`data-gap`) so it arrives whole.

**C · ink.** The closest to a classic text-over-picture VN: the screen is still, lines
appear, the page turn is the only motion and it is a wagon push. Scripts fire per line.
Price: the event pass no longer sees the scroll, so `parked` cannot be evaluated and
fires as `view`.

**D · box.** The familiar picture + dialogue box. It works, but it is the variant that
gives up the engine's premise — text on its picture, the same in book and VN. The text
exists twice (the box is a clone; an `id` inside it is duplicated), long portions scroll
inside the box, and steps inside one picture move nothing.

**E · clamp.** Touches no node and needs no browser feature. A page is as long as its
portions, not a screen: a cover picture is cut by a short page, the next picture can be
in sight below it, and the window still scrolls inside a tall page.

## What each variant would cost the engine

The prototypes reach these through the back door (`vn-proto.js`); each is the engine
change that variant implies.

| need | used by | today | change |
|---|---|---|---|
| relayout without re-firing scripts | A B C D | `refresh()` forgets which anchors fired | carry event flags across a refresh by anchor element |
| quiet boot | A B C D | the boot refresh fires whatever the book layout shows at scroll 0 | let a controller hold events until its first layout |
| events at a position that is not the scroll | B C D | events share the wagons' frame | an `eventPosition` beside `stylePosition` |
| `parked` without wagons in the pass | C D | needs wagon state | `parkedAsView` (exists) |
| a scrollport that is not the window | stage driver | `window.scrollY`, `window` scroll listener, in the engine and in the paged walk | a `scroller` option |
| step a long move without losing `view` | A B C D | an anchor that leaps the window is reported skipped | step in half-window pieces (done in `VN.moveTo`) |

Nothing else is needed for wagons or theme.

## Browser support

B and C hide unread text with the CSS Custom Highlight API (two ranges, no wrapper
elements): Chrome/Edge 105+, Safari 17.2+, Firefox 140+. The readability halo of read
text is a `text-shadow` on a highlight, which Firefox may not paint yet; the text itself
is unaffected. A, D and E need nothing beyond what the engine already needs.

## Testing

- **self-test** button (under "more" on a narrow screen): walks the whole story forward
  and back at speed 0 and checks that every numbered script fired, in document
  order, none skipped; that every picture is painted where the push chain puts it and no
  two overlap; that the current portion is on screen and nothing unread is; and that the
  same position paints the same pictures in both directions. "save report" writes the
  result to a file.
- The script log does the same check live: a red line is a script out of order or skipped.
- Speed "slow ×4" for watching a push; key `v` switches book ⇄ VN; `l` toggles the log.

## Files

- `story.js` — the test story and the functions its scripts call.
- `vn-proto.js`, `vn-proto.css` — the shared rig: scroll drivers, engine stepping, glide,
  page padding (`film`), portion rests (`feed`), ink, toolbar, log, self-test.
- `vn-*.html` — one controller each, 100–150 lines.
