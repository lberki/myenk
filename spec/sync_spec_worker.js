"use strict";

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

exports.latchSmokeTest = latchSmokeTest;
