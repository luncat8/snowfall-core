#!/usr/bin/env python3
"""make_scene.py — one command from ComfyUI outputs to a ready scene.

	input/<name>.ext    outpainted canvas (1080p/2K, author's single choice)
	input/<name>_c.ext  the HD original (typically 1024x1024 png)
	->
	img/<name>.avif     filler: hole in the ROI, low quality (plan-tools hole decision)
	img/<name>_c.avif   hd: 1:1 crop, high quality
	regions.js          GENERATED upsert

rect comes from --rect (ComfyUI workflow knows it) or CV match of the crop.
"""
import argparse
import sys
from pathlib import Path

from PIL import Image
import pillow_avif  # noqa: F401

sys.path.insert(0, str(Path(__file__).parent))
import match
import regions_writer

EXTS = [".png", ".jpg", ".jpeg", ".webp", ".avif"]


def find_input(folder, stem):
	for ext in EXTS:
		p = folder / (stem + ext)
		if p.exists():
			return p
	return None


def hole_fill(img, rect, mode):
	x, y, w, h = rect
	out = img.copy()
	if mode == "black":
		out.paste(Image.new("RGB", (w, h), (0, 0, 0)), (x, y))
	elif mode == "remnant":
		# 1/16 downscale upscaled: near-zero detail, colour-continuous, no hard edge
		small = img.crop((x, y, x + w, y + h)).resize((max(1, w // 16), max(1, h // 16)), Image.BILINEAR)
		out.paste(small.resize((w, h), Image.BILINEAR), (x, y))
	return out


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("name")
	ap.add_argument("--book", default=".")
	ap.add_argument("--rect", help="x,y,w,h in source pixels (else CV match)")
	ap.add_argument("--hole", choices=["remnant", "black", "full"], default="remnant")
	ap.add_argument("--filler-q", type=int, default=28)
	ap.add_argument("--hd-q", type=int, default=85)
	ap.add_argument("--maxw", type=int, default=2048)
	a = ap.parse_args()

	book = Path(a.book)
	src_path = find_input(book / "input", a.name)
	crop_path = find_input(book / "input", a.name + "_c")
	if src_path is None:
		raise SystemExit(f"input/{a.name}.* not found")
	src = Image.open(src_path).convert("RGB")

	rect = None
	note = "rect=manual"
	if a.rect:
		rect = [int(v) for v in a.rect.split(",")]
	else:
		if crop_path is None:
			raise SystemExit("no input crop and no --rect")
		pos = match.find_crop(src_path, crop_path)
		if pos is None:
			raise SystemExit("crop not found inside canvas; pass --rect")
		rect = [pos["x"], pos["y"], pos["w"], pos["h"]]
		note = f"rect=match conf={pos['conf']:.2f}"

	# single-resolution policy: one canvas size per scene
	if src.width > a.maxw:
		f = a.maxw / src.width
		src = src.resize((a.maxw, round(src.height * f)), Image.LANCZOS)
		rect = [round(v * f) for v in rect]

	x, y, w, h = rect
	(book / "img").mkdir(parents=True, exist_ok=True)

	filler = src if a.hole == "full" else hole_fill(src, rect, a.hole)
	filler_path = book / "img" / (a.name + ".avif")
	filler.save(filler_path, "AVIF", quality=a.filler_q)

	hd_path = None
	if crop_path is not None:
		Image.open(crop_path).convert("RGB").save(book / "img" / (a.name + "_c.avif"), "AVIF", quality=a.hd_q)
		hd_path = book / "img" / (a.name + "_c.avif")

	entry = {
		"x": x, "y": y, "w": w, "h": h,
		"bw": src.width, "bh": src.height,
		"note": note,
	}
	if hd_path:
		entry["hd"] = "img/" + a.name + "_c.avif"
	regions_writer.write_generated(a.book, {("img/" + a.name + ".avif"): entry})

	print(f"{filler_path}: {filler_path.stat().st_size // 1024} KB (filler q{a.filler_q}, hole={a.hole})")
	if hd_path:
		print(f"{hd_path}: {hd_path.stat().st_size // 1024} KB (hd q{a.hd_q})")
	print(f"region: x={x} y={y} w={w} h={h} ({note})")


if __name__ == "__main__":
	main()
