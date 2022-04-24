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
	w.root().foo = 1;
	let t = testutil.spawnWorker(
	    w, "sync_spec_worker.js", "latchSmokeTest",
	    ["phase1", "phase2"]);

	Atomics.wait(w._arena.int32, 1, 0, 500);
    });
});
