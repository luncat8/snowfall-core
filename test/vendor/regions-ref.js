/* test/vendor/regions-ref.js — the REFERENCE scenes, transcribed from
	HD-region regions.js with the shipped image sizes read off the vendored
	files in ../../img. Regenerate: node test/vendor/regions-ref.gen.js
	Run: node test/region-parity.js   (exit 0 = parity) */
'use strict';
var scenes = {
	'img/1.avif': { x: 477, y: 239, w: 804, h: 1056, hd: 'img/1_c.avif', bw: 1920, bh: 1536,
		imgW: 1920, imgH: 1536, hdW: 804, hdH: 1056 },
	'img/3.avif': { x: 476, y: 101, w: 1016, h: 900, hd: 'img/3_c.avif', bw: 1984, bh: 1152,
		imgW: 1984, imgH: 1152, hdW: 1016, hdH: 900 },
};
module.exports = scenes;
