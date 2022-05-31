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

    it("can keep objects live after gc", () => {
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

    it("can gc with freelist entry", async () => {
	let w = world.World.create(1024);
	w.root().foo = w.createDictionary();

	expect(w.objectCount()).toBe(1);

	await testutil.forceGc();  // Remove the reference from the local thread
	delete w.root().foo;  // Move the object to the freelist

	expect(w.objectCount()).toBe(0);
	w.gc();
	w.sanityCheck();
    });

    it("can deep copy simple values", () => {
	let w = world.World.create(1024);
	w.root().Number = w.deepCopy(42);
	w.root().Null = w.deepCopy(null);
	w.root().Undefined = w.deepCopy(undefined);
	w.root().Bool = w.deepCopy(true);
	w.root().String = "foo";

	expect(w.root().Number).toBe(42);
	expect(w.root().Null).toBe(null);
	expect(w.root().Undefined).toBe(undefined);
	expect(w.root().Bool).toBe(true);
	expect(w.root().String).toBe("foo");
    });

    it("can deep copy simple dictionaries", () => {
	let w = world.World.create(1024);
	w.root().d = w.deepCopy({"a": 2, "b": { "c": 4, "d": 5 }});
	expect(w.objectCount()).toBe(2);
	expect(w.root().d.a).toBe(2);
	expect(w.root().d.b.c).toBe(4);
	expect(w.root().d.b.d).toBe(5);
    });

    it("can deep copy simple arrays", () => {
	let w = world.World.create(1024);
	w.root().a1 = w.deepCopy([]);
	w.root().a2 = w.deepCopy([6, 5, null, "foo"]);

	expect(w.objectCount()).toBe(2);
	expect(w.root().a1.length).toBe(0);
	expect(w.root().a2.length).toBe(4);
	expect(w.root().a2[0]).toBe(6);
	expect(w.root().a2[1]).toBe(5);
	expect(w.root().a2[2]).toBe(null);
	expect(w.root().a2[3]).toBe("foo");
    });

    it("can deep copy recursive arrays", async () => {
	let w = world.World.create(1024);
	let rec = [];
	rec.push(rec);

	w.root().a = w.deepCopy(rec);
	expect(w.objectCount()).toBe(1);
	expect(w.root().a[0]).toBe(w.root().a);

	delete w.root().a;
	await testutil.forceGc();
	w.gc();
	expect(w.objectCount()).toBe(0);
    });

    it("can deep copy recursive dictionaries", async () => {
	let w = world.World.create(1024);
	let rec = {};
	rec.rec = rec;

	w.root().d = w.deepCopy(rec);
	expect(w.objectCount()).toBe(1);
	expect(w.root().d.rec).toBe(w.root().d);

	delete w.root().d;
	await testutil.forceGc();
	w.gc();
	expect(w.objectCount()).toBe(0);
    });

    it("refcount and gc stress test", async () => {
	let w = world.World.create(1024);
	w.root().done = false;

	let t = testutil.spawnWorker(
	    w, "world_spec_worker.js", "gcLoop", null, ["gcloop"]);

	// This seems to be a very low number of iterations but it is apparently enough to tickle
	// at least one bug
	for (let i = 0; i < 20; i++) {
	    w.root().a = w.createDictionary();
	    w.root().a.b = w.createDictionary();
	    w.root().a.b.c = w.createDictionary();
	    await testutil.forceGc();  // This thread now does not reference a.b and a.b.c
	    delete w.root().a;
	}

	w.root().done = true;
	t.wait("gcloop");

	// TODO: sanity check + object count
    });

    it("symbol allocation stress test", async () => {
	// Symbols are not deallocated so we need a lot of RAM
	let w = world.World.create(1024*1024);
	w.root().done = false;
	w.root().symbols = w.createArray();

	let t = testutil.spawnWorker(
	    w, "world_spec_worker.js", "gcLoop", null, ["gcloop"]);
	for (let i = 0; i < 1000; i++) {
	    let s = Symbol("stress test " + i);
	    w.root().symbols.push(s);
	    w.localSanityCheck();
	}
	w.root().done = true;
	t.wait("gcloop");

	// TODO: sanity check + check object count
    });
});
