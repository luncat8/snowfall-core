/* test/vendor/regions-ref.gen.js — rebuilds regions-ref.js from the reference
	repo (clone it, or point REPO at a checkout). Kept because a transcription
	nobody can reproduce is a claim, not a fixture.
	Run: node test/vendor/regions-ref.gen.js [path-to-HD-region] */
'use strict';
const fs = require('fs'), path = require('path');
const repo = process.argv[2] || '/tmp/HD-region';
const src = fs.readFileSync(path.join(repo, 'regions.js'), 'utf8');
function avifSize(f) {
	const d = fs.readFileSync(path.join(repo, f));
	const i = d.indexOf('ispe');
	if (i < 0) throw new Error('no ispe box in ' + f);
	return [d.readUInt32BE(i + 8), d.readUInt32BE(i + 12)];
}
const out = [];
for (const m of src.matchAll(/REGIONS\['([^']+)'\]\s*=\s*\{([^}]+)\}/g)) {
	const e = {};
	for (const f of m[2].matchAll(/(\w+):\s*(-?[\d.]+|'[^']*')/g)) {
		e[f[1]] = f[2][0] === "'" ? f[2].slice(1, -1) : +f[2];
	}
	const base = avifSize('img/' + path.basename(m[1])), hd = avifSize('img/' + path.basename(e.hd));
	out.push("\t'" + m[1] + "': { x: " + e.x + ', y: ' + e.y + ', w: ' + e.w + ', h: ' + e.h
		+ ", hd: '" + e.hd + "', bw: " + e.bw + ', bh: ' + e.bh + ',\n\t\timgW: ' + base[0]
		+ ', imgH: ' + base[1] + ', hdW: ' + hd[0] + ', hdH: ' + hd[1] + ' },');
}
const text = "/* test/vendor/regions-ref.js — the REFERENCE scenes, transcribed from\n"
	+ "\tHD-region regions.js with the shipped image sizes read off the vendored\n"
	+ "\tfiles in ../../img. Regenerate: node test/vendor/regions-ref.gen.js\n"
	+ "\tRun: node test/region-parity.js   (exit 0 = parity) */\n'use strict';\nvar scenes = {\n"
	+ out.join('\n') + "\n};\nmodule.exports = scenes;\n";
fs.writeFileSync(path.join(__dirname, 'regions-ref.js'), text);
console.log('wrote ' + out.length + ' scene(s) to test/vendor/regions-ref.js');
