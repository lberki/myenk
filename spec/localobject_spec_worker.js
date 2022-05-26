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
    delete w.root().foo;
    t.done("removed");
}

exports.smokeTest = smokeTest;
exports.keepAliveTest = keepAliveTest;
exports.otherThreadDeletesReferenceTest = otherThreadDeletesReferenceTest;
