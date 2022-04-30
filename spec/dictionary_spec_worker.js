"use strict";

let testutil = require("./testutil.js");

function singleDictionaryStressTest(w, t, param) {
    let obj = w.root().obj;
    let latch = w.root()["latch_" + param];

    w.root().start.wait();

    latch.dec();
}

exports.singleDictionaryStressTest = singleDictionaryStressTest;
