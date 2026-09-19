#!/usr/bin/env node
/* test/run.js — zero-dependency gate runner: spawns every test/*.js gate
	(except itself) and mirrors the worst exit code. `node test/run.js`. */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const gates = fs.readdirSync(dir)
	.filter(f => /\.js$/.test(f) && f !== 'run.js')
	.sort();
let failed = 0;
for (const g of gates) {
	console.log('=== ' + g + ' ===');
	const r = spawnSync(process.execPath, [path.join(dir, g)], { stdio: 'inherit' });
	if (r.status !== 0) failed++;
}
console.log(failed ? '\n' + failed + ' of ' + gates.length + ' gate(s) failed'
	: '\nall ' + gates.length + ' gate(s) green');
process.exit(failed ? 1 : 0);
