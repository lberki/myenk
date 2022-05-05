"use strict";

function parallelAllocStressTest(w, t, param) {
    let latch = w.root()["latch_" + param];
    let a = w._arena;

    w.root().start.wait();

    for (let i = 0; i < 1000; i++) {
	// TODO: it would be nice to exercise the memory we get to verify that two regions don't
	// overlap, but then I'd have to figure out how to convey an assertion failure from here to
	// the main test thread
	let b1 = a.alloc(32);
	let b2 = a.alloc(64);
	a.free(b1);
	a.free(b2);
    }

    latch.dec();
}

exports.parallelAllocStressTest = parallelAllocStressTest;
