"use strict";

let arena = require("../arena.js");
let world = require("../world.js");
let testutil = require("./testutil.js");

describe("arena", () => {
    it("exists", () => {
	expect(arena.Arena).not.toBeUndefined();
    });

    it("can allocate", () => {
	let cut = arena.Arena.create(128);
	let ptr1 = cut.alloc(24);
	let ptr2 = cut.alloc(24);
	let ptr3 = cut.alloc(24);
	ptr1.set32(0, 1);
	ptr2.set32(0, 2);
	ptr3.set32(0, 3);
	expect(ptr1.get32(0)).toBe(1);
	expect(ptr2.get32(0)).toBe(2);
	expect(ptr3.get32(0)).toBe(3);
	expect(cut.left()).toBe(128 - 3*24 - 3*arena.BLOCK_HEADER_SIZE);

	cut.sanityCheck();
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
	expect(cut.left()).toBe(32 - 4 - arena.BLOCK_HEADER_SIZE);
	expect(() => { ptr.get8(1); }).toThrow();
	cut.free(ptr);
	expect(cut.left()).toBe(32);
	cut.sanityCheck();
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
	expect(cut.left()).toBe(32 - 24 - arena.BLOCK_HEADER_SIZE);

	cut.sanityCheck();
    });

    it("can halve freed block", () => {
	let cut = arena.Arena.create(160);
	let ptr = cut.alloc(128);
	let ptrEnd = cut.alloc(16);
	expect(cut.sanityCheck()).toEqual([128, 16]);
	cut.free(ptr);

	let ptr1 = cut.alloc(48);
	expect(cut.left()).toBe(160 - 48 - 16 - 2*arena.BLOCK_HEADER_SIZE);
	expect(cut.sanityCheck()).toEqual([48, 128-48-arena.BLOCK_HEADER_SIZE, 16]);

	let ptr2 = cut.alloc(48);
	expect(cut.left()).toBe(160 - 48 - 48 - 16 - 3*arena.BLOCK_HEADER_SIZE);
	expect(cut.sanityCheck()).toEqual([48, 48, 128-2*48-2*arena.BLOCK_HEADER_SIZE, 16]);
    });

    it("can skip block too small", () => {
	let cut = arena.Arena.create(64);
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

	cut.sanityCheck();
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
	w._arena.sanityCheck();
    });
});
