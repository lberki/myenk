"use strict";

let arena = require("../arena.js");
let world = require("../world.js");
let testutil = require("./testutil.js");

describe("arena", () => {
    it("exists", () => {
	expect(arena.Arena).not.toBeUndefined();
    });

    it("can allocate", () => {
	let cut = arena.Arena.create(32);
	let ptr = cut.alloc(24);
	ptr.set32(0, 1);
	expect(ptr.get32(0)).toBe(1);
	expect(cut.left()).toBe(4);
    });

    it("returns size", () => {
	let cut = arena.Arena.create(128);
	let ptr = cut.alloc(60);
	expect(ptr.size()).toBe(60);
    });

    it("rounds up allocations", () => {
	let cut = arena.Arena.create(32);
	let ptr = cut.alloc(1);
	expect(ptr.size()).toBe(1);
	expect(cut.left()).toBe(24);  // alloc: 4 (rounded up) + 4 (header)
	expect(() => { ptr.get8(1); }).toThrow();
	cut.free(ptr);
	expect(cut.left()).toBe(32);
    });

    it("can create from existing", () => {
	let cut = arena.Arena.create(32);
	let cut2 = arena.Arena.existing(cut.bytes);
    });

    it("can reallocate freed block", () => {
	let cut = arena.Arena.create(32);
	let ptr = cut.alloc(24);
	ptr.set32(2, 1);
	cut.free(ptr);
	expect(cut.left()).toBe(32);
	ptr = cut.alloc(24);
	expect(ptr.get32(2)).toBe(1);
	expect(cut.left()).toBe(4);
    });

    it("can halve freed block", () => {
	let cut = arena.Arena.create(32);
	let ptr = cut.alloc(28);
	cut.free(ptr);
	let ptr1 = cut.alloc(12);
	expect(cut.left()).toBe(16);
	let ptr2 = cut.alloc(12);
	expect(cut.left()).toBe(0);
    });

    it("can skip block too small", () => {
	let cut = arena.Arena.create(48);
	let small = cut.alloc(8);
	let large = cut.alloc(16);
	small.set32(1, 3);
	large.set32(1, 4);

	cut.free(large);
	cut.free(small);

	large = cut.alloc(16);
	small = cut.alloc(8);

	// Check if we got back the same blocks
	expect(large.get32(1)).toBe(4);
	expect(small.get32(1)).toBe(3);
    });

    it("can throw OOM", () => {
	let cut = arena.Arena.create(32);
	expect(() => { cut.alloc(64); }).toThrow();
    });

    it("can detect buffer underflow / overflow", () => {
	let cut = arena.Arena.create(32);
	let ptr = cut.alloc(8);

	expect(() => { ptr.get32(-1) }).toThrow();
	expect(() => { ptr.get32(2) }).toThrow();
    });

    // It's kinda ugly that the tests of Arena depend on World, but it would be damn inconvenient to
    // orchestrate the test without testutil, which needs world. It also provides a convenient way
    // to create a shared Arena.
    it("parallel allocation stress test", () => {
	const NUM_WORKERS = 4;

	let w = world.World.create(1024);
	w.root().start = w.createLatch(1);

	let workers = new Array();
	for (let i = 0; i < NUM_WORKERS; i++) {
	    w.root()["latch_" + i] = w.createLatch(1);
	    workers.push(testutil.spawnWorker(
		w, "arena_spec_worker.js", "parallelAllocStressTest",
		i, []));
	}

	let before = w._arena.left();

	w.root().start.dec();

	for (let i = 0; i < NUM_WORKERS; i++) {
	    w.root()["latch_" + i].wait();
	}

	expect(w._arena.left()).toBe(before);
    });
});
