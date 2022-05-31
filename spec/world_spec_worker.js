"use strict";

let testutil = require("./testutil.js");

let world = require("../world.js");

function gcLoop(w, t) {
    while (!w.root().done) {
	w.gc();
    }

    t.done("gcloop");
}

exports.gcLoop = gcLoop;
