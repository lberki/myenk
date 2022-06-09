"use strict";

const util = require("../util.js");
const debuglog = util.debuglog("test");

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

    it("RwLock smoke test", () => {
	let w = world.World.create(2048);

	for (let l of ["start1", "start2", "start3", "start4",
		       "rlocked1", "rlocked2", "wlocked3", "wlocked4",
		       "done1",
		       "unlock1", "unlock2", "unlock3", "unlock4"]) {
	    w.root()[l] = w.createLatch(1);
	}

	w.root().rwlock = w.createRwLock();
	w.root().join = w.createLatch(4);
	w.root().result = "start";

	let workers = new Array();

	for (let i = 1; i <= 4; i++) {
	    workers.push(testutil.spawnWorker(
		w, "sync_spec_worker.js", "rwLockSmoke" + i,
		i, []));
	}

	w.root().start1.dec();
	w.root().rlocked1.wait();
	w.root().start2.dec();
	w.root().start3.dec();
	w.root().start4.dec();
	w.root().rlocked2.wait();
	w.root().unlock1.dec();
	w.root().done1.wait();
	w.root().unlock2.dec();
	w.root().join.wait();
	expect(w.root().result).toBe("start rlock rlock runlock runlock wlock wunlock wlock wunlock");
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

	expect(w.root().foo).toBe((4000+1)/2 * 4000 * NUM_WORKERS);
    });

    it("RwLock stress test", () => {
	const NUM_WRITE_WORKERS = 2;
	const NUM_READ_WORKERS = 4;

	let w = world.World.create(1024);
	w.root().foo = 0;
	w.root().start = w.createLatch(1);
	w.root().rwlock = w.createRwLock();
	w.root().join = w.createLatch(NUM_WRITE_WORKERS + NUM_READ_WORKERS);

	let workers = new Array();
	for (let i = 0; i < NUM_READ_WORKERS; i++) {
	    workers.push(testutil.spawnWorker(
		w, "sync_spec_worker.js", "rwLockStressTestRead",
		i, []));
	}

	for (let i = 0; i < NUM_WRITE_WORKERS; i++) {
	    workers.push(testutil.spawnWorker(
		w, "sync_spec_worker.js", "rwLockStressTestWrite",
		i, []));
	}

	w.root().start.dec();
	w.root().join.wait();

	expect(w.root().foo).toBe((2000+1)/2 * 2000 * NUM_WRITE_WORKERS);
    });
});
