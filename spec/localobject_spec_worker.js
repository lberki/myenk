"use strict";

let testutil = require("./testutil.js");

let world = require("../world.js");

function smokeTest(w, t) {
    w.root().bar = w.root().foo;
    t.done("moved");
}

function keepAliveTest(w, t) {
    let foreign = w.root().foo;
    delete w.root().foo;

    t.done("removed");
    t.wait("gc");
    w.root().foo2 = foreign;
    t.done("replaced");
}

function otherThreadDeletesReferenceTest(w, t) {
    t.done("started");
    t.wait("set");
    delete w.root().foo1;
    delete w.root().foo2;
    t.done("removed");
}

function reuseObjectInDumpsterTest(w, t) {
    delete w.root().foo1;
    delete w.root().foo2;
    t.done("removed");
}

function throwOnOtherThreadTest(w, t) {
    try {
	let tmp = w.root().foo.foo;
    } catch (e) {
	w.root().thrown = true;
    } finally {
	t.done("referenced");
    }
}

exports.smokeTest = smokeTest;
exports.keepAliveTest = keepAliveTest;
exports.otherThreadDeletesReferenceTest = otherThreadDeletesReferenceTest;
exports.reuseObjectInDumpsterTest = reuseObjectInDumpsterTest;
exports.throwOnOtherThreadTest = throwOnOtherThreadTest;
