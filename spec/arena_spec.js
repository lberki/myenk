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
	expect(cut.left()).toBe(32 - 8 - arena.BLOCK_HEADER_SIZE);
	expect(() => { ptr.get8(1); }).toThrow();
	cut.free(ptr);
	expect(cut.left()).toBe(32);
	cut.sanityCheck();
    });

    it("can create from existing", () => {
	let cut = arena.Arena.create(32);
	let cut2 = arena.Arena.existing(cut.bytes);
    });

    it("can free twice", () => {
	let cut = arena.Arena.create(64);
	let ptr1 = cut.alloc(16);
	let ptr2 = cut.alloc(16);

	cut.free(ptr1);
	cut.free(ptr2);
	cut.sanityCheck();
    });

    it("can reallocate middle block", () => {
	let cut = arena.Arena.create(128);
	let ptr1 = cut.alloc(16);
	let ptr2 = cut.alloc(32);
	let ptr3 = cut.alloc(16);

	cut.free(ptr1);
	cut.sanityCheck();
	cut.free(ptr2);
	cut.sanityCheck();
	cut.free(ptr3);
	cut.sanityCheck();

	let ptr4 = cut.alloc(32);
	cut.sanityCheck();
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

    it("can halve freed block in the middle of freelist", () => {
	let cut = arena.Arena.create(256);
	let ptrBefore = cut.alloc(8);
	let halved = cut.alloc(128);
	let ptrAfter = cut.alloc(8);

	cut.free(ptrBefore);
	cut.free(halved);
	cut.free(ptrAfter);
	cut.sanityCheck();

	let ptr1 = cut.alloc(48);
	cut.sanityCheck();

	let ptr2 = cut.alloc(48);
	cut.sanityCheck();
    });

    it("can merge free blocks from the middle", () => {
	let cut = arena.Arena.create(3*8 + 3*arena.BLOCK_HEADER_SIZE);

	let ptr1 = cut.alloc(8);
	let ptr2 = cut.alloc(8);
	let ptr3 = cut.alloc(8);

	cut.free(ptr1);
	cut.free(ptr3);
	cut.free(ptr2);

	let ptr = cut.alloc(24 + 2*arena.BLOCK_HEADER_SIZE);
    });

    it("can merge free blocks from the beginning", () => {
	let cut = arena.Arena.create(3*8 + 3*arena.BLOCK_HEADER_SIZE);

	let ptr1 = cut.alloc(8);
	let ptr2 = cut.alloc(8);
	let ptr3 = cut.alloc(8);

	cut.free(ptr1);
	cut.free(ptr2);
	cut.free(ptr3);

	let ptr = cut.alloc(24 + 2*arena.BLOCK_HEADER_SIZE);
    });

    it("can merge free blocks from the end", () => {
	let cut = arena.Arena.create(3*8 + 3*arena.BLOCK_HEADER_SIZE);

	let ptr1 = cut.alloc(8);
	let ptr2 = cut.alloc(8);
	let ptr3 = cut.alloc(8);

	cut.free(ptr3);
	cut.free(ptr2);
	cut.free(ptr1);

	let ptr = cut.alloc(24 + 2*arena.BLOCK_HEADER_SIZE);
    });

    it("can merge free blocks in the middle of freelist", () => {
	let cut = arena.Arena.create(3*8 + 2*16 + 5*arena.BLOCK_HEADER_SIZE);

	let ptr1 = cut.alloc(8);
	let ptr2 = cut.alloc(8);
	let ptr3 = cut.alloc(8);
	let ptr4 = cut.alloc(16);
	let ptr5 = cut.alloc(16);

	cut.free(ptr4);
	cut.free(ptr1);
	cut.free(ptr3);
	cut.free(ptr2);
	cut.free(ptr5);

	let ptr = cut.alloc(24 + 2*arena.BLOCK_HEADER_SIZE);
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

	let w = world.World.create(2048);
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

	// TODO: account for dumpsters in a sane manner
	expect(w._arena.left()).toBe(before - NUM_WORKERS * 16);
	w._arena.sanityCheck();
    });

    it("single-threaded allocation stress test", () => {
	let cut = arena.Arena.create(65536);
	let blocks = [];
	let rng = new testutil.PRNG(1);

	for (let i = 0; i < 1000; i++) {
	    // Try to keep the number of blocks allocated around 100, but at most 200
	    let r = rng.upto(200);
	    if (r < blocks.length) {
		let block = blocks.splice(rng.upto(blocks.length), 1);
		cut.free(block);
	    } else {
		let block = cut.alloc(rng.upto(128) + 8);
		blocks.push(block);
	    }
	}

	cut.sanityCheck();
    });
});
