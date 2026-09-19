#!/usr/bin/env python3
"""Crop-in-container matching shared by scan.py and make_scene.py.

Direction fix vs the drafts: the BASE (outpaint) is the container, the _c crop
is the template. Drafts had it inverted and never matched anything.
"""
import cv2
import numpy as np
from PIL import Image

WARN = 0.95
REJECT = 0.8


def read_bgr(path):
	"""PIL decodes avif/webp/png/jpg; cv2.imread does not (avif)."""
	img = Image.open(path).convert("RGB")
	return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def is_animated(path):
	try:
		with Image.open(path) as im:
			return getattr(im, "n_frames", 1) > 1
	except Exception:
		return True


def find_crop(container_path, template_path):
	"""Position+size of the crop inside the container, or None.

	w/h = template (crop) size in container pixels — the drafts returned the
	container dims here, which is wrong.
	"""
	cont = read_bgr(container_path)
	templ = read_bgr(template_path)
	ch, cw = cont.shape[:2]
	th, tw = templ.shape[:2]
	if tw > cw or th > ch:
		return None
	res = cv2.matchTemplate(cont, templ, cv2.TM_CCOEFF_NORMED)
	_, conf, _, (x, y) = cv2.minMaxLoc(res)
	if conf < WARN:
		print(f"  warning: low confidence {conf:.3f} for {template_path}")
	if conf < REJECT:
		return None
	return {"x": int(x), "y": int(y), "w": int(tw), "h": int(th), "conf": float(conf)}
