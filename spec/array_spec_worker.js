"use strict";

let testutil = require("./testutil.js");
let world = require("../world.js");

function pushPopStressTest(w, t, param) {
    let workerId = param;
    let a = w.root().array;

    w.root().start.wait();

    for (let i = 1; i <= 100; i++) {
	for (let j = 0; j < workerId; j++) {
	    a.push(workerId * 1000 + j);
	}

	for (let j = 0; j < workerId; j++) {
	    a.pop();
	}
    }

    w.root().end.dec();
}

async function getSetStressTest(w, t, param) {
    w.root().start.wait();

    let a = w.root().array;
    let arrayLength = a.length;
    let values = w.root().values;
    let valueCount = values.length;

    let prng = new testutil.PRNG(1);

    for (let i = 0; i < 1000; i++) {
	let value;
	switch (prng.upto(3)) {
	case 0:
	    value = values.at(prng.upto(valueCount));
	    break;
	case 1:
	    value = prng.upto(100);
	    break;
	case 2:
	    value = a[prng.upto(arrayLength)];
	    break;
	}

	let idx = prng.upto(arrayLength);
	a[idx] = value;

	// This is crazy, but "value" going out of scope is apparently not enough for the V8 garbage
	// collector to realize that the reference is gone, even if we explicitly call the GC below.
	value = null;
    }

    a = null;
    values = null;
    await testutil.forceGc();
    w.root().end.dec();
}

exports.pushPopStressTest = pushPopStressTest;
exports.getSetStressTest = getSetStressTest;
