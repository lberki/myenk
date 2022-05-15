"use strict";

let testutil = require("./testutil.js");
let world = require("../world.js");

function arrayStressTest(w, t, param) {
    let lock = w.root().lock;
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

exports.arrayStressTest = arrayStressTest;
