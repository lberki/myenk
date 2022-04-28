"use strict";

let worker_threads = require("worker_threads");

let testutil = require("./testutil.js");
let sync = require("../sync.js");
let world = require("../world.js");

describe("sync", () => {
    it("has Latch", () => {
	expect(sync.Latch).toBeDefined();
    });

    it("Latch smoke test", () => {
	let w = world.World.create(1024);
	w.root().foo = "start";
	let t = testutil.spawnWorker(
	    w, "sync_spec_worker.js", "latchSmokeTest",
	    null,
	    ["one", "two", "three", "four", "five"]);

	t.wait("one");
	w.root().foo += " main2";
	t.done("two");
	t.wait("three");
	w.root().foo += " main4";
	t.done("four");
	t.wait("five");

	expect(w.root().foo).toBe("start worker1 main2 worker3 main4 worker5");
    });

    it("Lock stress test", () => {
	const NUM_WORKERS = 4;

	let w = world.World.create(1024);
	w.root().foo = 0;
	w.root().start = w.createLatch(1);
	w.root().lock = w.createLock();

	let workers = new Array();
	for (let i = 0; i < NUM_WORKERS; i++) {
	    w.root()["latch_" + i] = w.createLatch(1);
	    workers.push(testutil.spawnWorker(
		w, "sync_spec_worker.js", "lockStressTest",
		i, []));
	}

	w.root().start.dec();

	for (let i = 0; i < NUM_WORKERS; i++) {
	    w.root()["latch_" + i].wait();
	}

	expect(w.root().foo).toBe((5000+1)/2 * 5000 * NUM_WORKERS);
    });
});
