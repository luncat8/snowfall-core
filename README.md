## snowfall-core visual novella engine

early development stage

* scroll as book
* paged as typical VN — `snowfall-paged.js` is the controller: one page is a
  screenful of the author's own portions (cut at `p` / `section` / `br`), the
  page ends at the last stop that fits and the text you have read leaves the
  page; a portion taller than the screen is its own page, walked one band a
  tap; everything else works as in book mode;
  `0.6.0-plan-paged-mode.md` is the plan, `demo-paged.html` the playable page
  with a book/paged toggle
* without js fallback to readable html
* compatible with epub syntax for easy convert
* minigames as one `.js` file plus an optional `.css` — `games/gamble.js` is
  the example, `archive/0.4.3-plan-minigames.md` the contract, `demo-minigame.html` the
  playable page

No strict syntax, don't force author to write in specific notation - just place backgrounds and scripts in text.

Vanilla js, no build, no server need, possible to bundle into single html file and open with double click.

engine repo https://github.com/luncat8/snowfall-core.git

Region layout follows the HD-region reference (https://github.com/luncat8/HD-region.git):
`test/vendor/hdregion-ref.js` is a pinned copy of its math and `test/region-parity.js`
holds the two in agreement to 1e-6, on that repo's own example scenes in `img/`.
