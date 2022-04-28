"use strict";

let testutil = require("./testutil.js");

let world = require("../world.js");

function latchSmokeTest(w, t) {
    w.root().foo += " worker1";
    t.done("one");
    t.wait("two");
    w.root().foo += " worker3";
    t.done("three");
    t.wait("four");
    w.root().foo += " worker5";
    t.done("five");
}

function lockStressTest(w, t, param) {
    let lock = w.root().lock;
    let latch = w.root()["latch_" + param];

    w.root().start.wait();

    for (let i = 1; i <= 5000; i++) {
	lock.lock();
	w.root().foo += i;
	lock.unlock();
    }

    latch.dec();
}

exports.latchSmokeTest = latchSmokeTest;
exports.lockStressTest = lockStressTest;
