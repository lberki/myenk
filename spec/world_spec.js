"use strict";

let worker_threads = require("worker_threads");

let testutil = require("./testutil.js");
let dictionary = require("../dictionary.js");
let world = require("../world.js");

describe("world", () => {
    it("has a root object", () => {
	let w = world.World.create(1024);
	w.root().foo = 42;
	expect(w.root().foo).toBe(42);
    });

    it("can share a buffer on the same thread", () => {
	let w = world.World.create(1024);
	w.root().foo = 42;

	let w2 = world.World.existing(w.buffer());
	expect(w2.root().foo).toBe(42);

	w.root().foo = 43;
	expect(w2.root().foo).toBe(43);
    });

    it("object created by a thread is kept alive by another", async () => {
	let w1 = world.World.create(1024);
	let w2 = world.World.existing(w1.buffer());

	w1.root().foo = w1.createDictionary();
	w1.root().foo.bar = 42;

	let obj = w2.root().foo;
	delete w1.root().foo;

	await testutil.forceGc();
	expect(w1.objectCount()).toBe(1);

	obj = null;
	await testutil.forceGc();
	expect(w1.objectCount()).toBe(0);
    });

    it("can free dictionary reference cycles", async () => {
	let w = world.World.create(1024);
	w.root().foo = w.createDictionary();
	w.root().bar = w.createDictionary();
	w.root().foo.bar = w.root().bar;
	w.root().bar.foo = w.root().foo;

	delete w.root().foo;
	delete w.root().bar;

	await testutil.forceGc();
	expect(w.objectCount()).toBe(2);  // Cycle is not freed on JS GC

	w.gc();
	w.sanityCheck();
	expect(w.objectCount()).toBe(0);
    });

    it("can free array reference cycles", async () => {
	let w = world.World.create(1024);

	w.root().foo = w.createArray();
	w.root().bar = w.createArray();
	w.root().foo[0] = w.root().bar;
	w.root().bar[0] = w.root().foo;

	delete w.root().foo;
	delete w.root().bar;

	await testutil.forceGc();
	expect(w.objectCount()).toBe(2);  // Cycle is not freed on JS GC

	w.gc();
	w.sanityCheck();
	expect(w.objectCount()).toBe(0);
    });

    it("can keep objects live", () => {
	let w = world.World.create(1024);
	w.root().foo = w.createDictionary();
	w.root().bar = w.createDictionary();

	w.gc();
	w.sanityCheck();
	expect(w.objectCount()).toBe(2);

	// Run another GC cycle, just in case
	w.gc();
	w.sanityCheck();
	expect(w.objectCount()).toBe(2);
    });
});
