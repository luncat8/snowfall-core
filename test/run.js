#!/usr/bin/env node
/* test/run.js — runs every node gate, zero dependencies.
   node test/run.js — exit 0 = all green. Individual gates also run standalone:
   node test/math.js, node test/region.js. DOM/page behaviour belongs to the
   in-GUI QA probes (harness.js, `QA all`), never to this runner. */
'use strict';

const GATES = [
	['math', './math.js'],
	['region', './region.js']
];

let fails = 0;
for (const g of GATES) {
	const gate = require(g[1]);
	const f = gate.run();
	fails += f;
	console.log(g[0] + ': ' + (f ? f + ' FAILURES' : 'PASS') + ' (' + gate.checks() + ' checks)');
}
console.log(fails ? 'RUN: ' + fails + ' FAILURE(S)' : 'RUN: ALL GREEN');
process.exit(fails ? 1 : 0);
