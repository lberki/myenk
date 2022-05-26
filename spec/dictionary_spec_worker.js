"use strict";

let testutil = require("./testutil.js");

async function singleDictionaryStressTest(w, t, param) {
    w.root().worldsCreated.dec();
    w.root().start.wait();

    let obj = w.root().obj;
    let rnd = new testutil.PRNG(param);

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
	w.root().workersDone.dec();
    }
}

exports.singleDictionaryStressTest = singleDictionaryStressTest;
