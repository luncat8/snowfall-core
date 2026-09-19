#!/usr/bin/env python3
"""scan.py — detect _c crops inside base images, write/check regions.js.

Convention: input pair = base `name.ext` (outpaint) + crop `name_c.ext` (hd).
Default rewrites the GENERATED block of <book>/regions.js; --check only prints.
Acceptance (archive/plan-tools.md): over input it must report 3.avif -> 476,101,1016,900.
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import match
import regions_writer

EXTS = [".png", ".jpg", ".jpeg", ".webp", ".avif"]


def collect(root):
	files = {}
	for r, _, names in os.walk(root):
		p = Path(r)
		if p.name.startswith("."):
			continue
		for n in names:
			f = p / n
			if f.suffix.lower() in EXTS and not match.is_animated(f):
				files[f] = f.stem
	return files


def scan(root):
	files = collect(root)
	entries = {}
	for f, stem in sorted(files.items(), key=lambda kv: str(kv[0])):
		if not stem.endswith("_c"):
			continue
		base_stem = stem[:-2]
		crop = f
		base = next((c for c in files if c.parent == f.parent and c.stem == base_stem), None)
		if base is None:
			print(f"skip {crop.name}: no base {base_stem}.*")
			continue
		pos = match.find_crop(base, crop)
		if pos is None:
			print(f"skip {crop.name}: no match in {base.name}")
			continue
		key = base.relative_to(root).as_posix()
		entries[key] = {
			"x": pos["x"], "y": pos["y"], "w": pos["w"], "h": pos["h"],
			"hd": crop.relative_to(root).as_posix(),
			"bw": int(match.read_bgr(base).shape[1]), "bh": int(match.read_bgr(base).shape[0]),
			"note": f"from {crop.name} conf={pos['conf']:.2f}",
		}
		print(f"{key}: x={pos['x']} y={pos['y']} w={pos['w']} h={pos['h']} conf={pos['conf']:.3f}")
	return entries


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("book", nargs="?", default=".")
	ap.add_argument("--check", action="store_true", help="print detections, write nothing")
	a = ap.parse_args()
	entries = scan(Path(a.book).resolve())
	if not entries:
		print("no pairs found")
		return
	if a.check:
		return
	path = regions_writer.write_generated(a.book, entries, replace=True)
	print(f"wrote {path} ({len(entries)} entries)")


if __name__ == "__main__":
	main()
