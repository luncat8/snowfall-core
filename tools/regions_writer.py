#!/usr/bin/env python3
"""regions.js writer: rewrites the GENERATED block, preserves MANUAL byte-for-byte.

Contract: archive/plan-storage.md. Later assignments win, so MANUAL overrides GENERATED.
"""
from pathlib import Path

GB = "/* ===== GENERATED-BEGIN"
GE = "/* ===== GENERATED-END"
MB = "/* ===== MANUAL-BEGIN"
ME = "/* ===== MANUAL-END"

TEMPLATE = """/* regions.js — scene region data for this book.
   GENERATED part: rewritten by tools (scan.py / make_scene.py). Do not edit it.
   MANUAL part:    editors edit here; the generator preserves it byte-for-byte.
   Fields (base-image pixels): x y w h  [hd]  [bw bh]  [title]  [maxZoom] */
var REGIONS = typeof window !== 'undefined'
	? (window.REGIONS = window.REGIONS || {})
	: {};

/* ===== GENERATED-BEGIN (tools) ===== */
/* ===== GENERATED-END ===== */

/* ===== MANUAL-BEGIN ===== */
/* Editors: override anything above, e.g.
   REGIONS['img/3.avif'].maxZoom = 2;
   SCENES = ['img/1.avif', 'img/3.avif'];   // custom order / subset; default = key order
*/
/* ===== MANUAL-END ===== */

if (typeof module !== 'undefined') module.exports = { REGIONS: REGIONS, SCENES: typeof SCENES !== 'undefined' ? SCENES : null };
"""


def entry_line(key, e):
	line = (f"REGIONS['{key}'] = {{ x: {e['x']}, y: {e['y']}, w: {e['w']}, h: {e['h']}")
	if e.get("hd"):
		line += f", hd: '{e['hd']}'"
	if e.get("bw"):
		line += f", bw: {e['bw']}, bh: {e['bh']}"
	note = e.get("note", "")
	return line + " };" + (f" // {note}" if note else "")


import re

LINE_RE = re.compile(r"^REGIONS\['([^']+)'\] = .*$")


def parse_generated(text):
	"""key -> raw line, so untouched entries keep their notes across rewrites."""
	gi, ge = text.find(GB), text.find(GE)
	if gi < 0 or ge < 0:
		return {}
	out = {}
	for line in text[gi:ge].splitlines():
		m = LINE_RE.match(line.strip())
		if m:
			out[m.group(1)] = line.strip()
	return out


def write_generated(book, entries, replace=False):
	"""entries: {key: {x,y,w,h[,hd,bw,bh,note]}}.
	replace=False (make_scene): upsert, keep other entries.
	replace=True  (scan): full rewrite of the GENERATED block."""
	path = Path(book) / "regions.js"
	if not path.exists():
		path.write_text(TEMPLATE, encoding="utf-8")
	text = path.read_text(encoding="utf-8")
	gi, ge = text.find(GB), text.find(GE)
	if gi < 0 or ge < 0:
		raise SystemExit(f"regions.js markers broken in {path}; restore them manually")
	merged = {} if replace else parse_generated(text)
	for k in entries:
		merged[k] = entry_line(k, entries[k])
	body = "".join(merged[k] + "\n" for k in sorted(merged))
	path.write_text(text[:gi] + GB + " (tools) ===== */\n" + body + text[ge:], encoding="utf-8")
	return path
