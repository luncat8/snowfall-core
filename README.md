## snowfall-core visual novella engine

early development stage

* scroll as book
* paged as typical VN
* without js fallback to readable html
* compatible with epub syntax for easy convert

No strict syntax, don't force author to write in specific notation - just place backgrounds and scripts in text.

Vanilla js, no build, no server need, possible to bundle into single html file and open with double click.

engine repo https://github.com/luncat8/snowfall-core.git

Region layout follows the HD-region reference (https://github.com/luncat8/HD-region.git):
`test/vendor/hdregion-ref.js` is a pinned copy of its math and `test/region-parity.js`
holds the two in agreement to 1e-6, on that repo's own example scenes in `img/`.
