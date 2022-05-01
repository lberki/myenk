"use strict";

let testutil = require("./testutil.js");

async function singleDictionaryStressTest(w, t, param) {
    let obj = w.root().obj;
    let latch = w.root()["latch_" + param];
    let rnd = new testutil.PRNG(param);

    w.root().start.wait();

    try {
	for (let i = 0; i < 500; i++) {
	    let op = rnd.upto(3);
	    let key = rnd.upto(20);
	    let value = rnd.upto(100);

	    switch (op) {
	    case 0:
		delete obj[key];
		break;

	    case 1:
	    case 2:
		obj[key] = value;
		break;
	    }
	}
    } finally {
	obj = null;
	await testutil.forceGc();
	latch.dec();
    }
}

exports.singleDictionaryStressTest = singleDictionaryStressTest;
