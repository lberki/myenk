"use strict";

let testutil = require("./testutil.js");

let world = require("../world.js");

function smokeTest(w, t) {
    w.root().bar = w.root().foo;
    w.localSanityCheck();
    t.done("moved");
}

exports.smokeTest = smokeTest;
