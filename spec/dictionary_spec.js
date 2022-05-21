"use strict";

let worker_threads = require("worker_threads");

let testutil = require("./testutil.js");
let dictionary = require("../dictionary.js");
let sync = require("../sync.js");
let world = require("../world.js");

describe("dictionary", () => {
    it("dictionary smoke test", () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();
	obj.foo = 3;
	expect(obj.foo).toBe(3);
    });

    it("can be freed", async () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();
	obj = null;

	await testutil.forceGc();
	expect(w.objectCount()).toBe(0);
	w.sanityCheck();
    });

    it("can free property", async () => {
	let w = world.World.create(1024);
	let before = w.left();
	let obj = w.createDictionary();
	obj.foo = 2;
	obj.bar = 2;
	obj = null;

	await testutil.forceGc();
	expect(w.left()).toBe(before);
    });

    it("can free deleted property", async () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();
	let before = w.left();
	obj.foo = 2;
	delete obj.foo;
	expect(w.left()).toBe(before);
    });

    it("can overwrite property", () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();
	obj.foo = 3;
	obj.foo = 4;
	expect(obj.foo).toBe(4);
    });

    it("can delete property", () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();
	obj.foo = 3;
	delete(obj.foo);
	expect(obj.foo).toBe(undefined);
    });

    it("can check for property presence", () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();

	obj.foo = 3;
	expect("foo" in obj).toBe(true);

	delete obj.foo;
	expect("foo" in obj).toBe(false);
    });

    it("supports unique values", () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();
	obj.foo = undefined;
	obj.bar = null;

	expect(obj.foo).toBe(undefined);
	expect(obj.bar).toBe(null);
    });

    it("supports extremal 32-bit values", () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();

	obj.small = -2147483648;
	obj.big = 2147483647;
	obj.zero = 0;
	obj.one = 1;
	obj.minusone = -1;

	expect(obj.small).toBe(-2147483648);
	expect(obj.big).toBe(2147483647);
	expect(obj.zero).toBe(0);
	expect(obj.one).toBe(1);
	expect(obj.minusone).toBe(-1);
    });

    it("supports Boolean values", () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();
	obj.yes = true;
	obj.no = false;

	expect(obj.yes).toBe(true);
	expect(obj.no).toBe(false);
    });

    it("supports string values", async () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();
	obj.foo = "bar";
	expect(obj.foo).toBe("bar");

	obj = null;
	await testutil.forceGc();
	expect(w.objectCount()).toBe(0);
    });

    it("supports empty strings", async () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();
	obj.foo = "";
	expect(obj.foo).toBe("");

	obj = null;
	await testutil.forceGc();
	expect(w.objectCount()).toBe(0);
    });

    it("increases refcount on object reference", async () => {
	let w = world.World.create(1024);
	let obj1 = w.createDictionary();
	let obj2 = w.createDictionary();
	obj1.foo = obj2;
	obj2 = null;

	let leftBeforeGc = w.left();
	await testutil.forceGc();
	expect(w.left()).toBe(leftBeforeGc);
	w.sanityCheck();
    });

    it("decreases refcount on change object reference", async () => {
	let w = world.World.create(1024);
	let obj1 = w.createDictionary();
	let obj2 = w.createDictionary();
	obj1.foo = obj2;
	obj2 = null;
	obj1.foo = 1;
	obj1 = null;
	w.sanityCheck();

	await testutil.forceGc();
	expect(w.objectCount()).toBe(0);
	w.sanityCheck();
    });

    it("decreases refcount on delete object refeence", async () => {
	let w = world.World.create(1024);
	let obj1 = w.createDictionary();
	let obj2 = w.createDictionary();
	obj1.foo = obj2;
	delete obj1.foo;
	obj1 = null;
	obj2 = null;

	await testutil.forceGc();
	expect(w.objectCount()).toBe(0);
    });

    it("supports simple object references", () => {
	let w = world.World.create(1024);
	let obj1 = w.createDictionary();
	let obj2 = w.createDictionary();
	obj1.foo = obj2;

	// Don't use expect(obj1.foo) because Jasmine apparently expects a lot of things from
	// objects passed to expect() we can't do yet
	// TODO: change it once Dictionary is smart enough
	expect(obj1.foo === obj2).toBe(true);
    });

    it("supports circular object references", () => {
	let w = world.World.create(1024);
	let obj1 = w.createDictionary();
	let obj2 = w.createDictionary();

	obj1.other = obj2;
	obj2.other = obj1;

	// Don't use expect(obj1.foo) because Jasmine apparently expects a lot of things from
	// objects passed to expect() we can't do yet
	// TODO: change it once Dictionary is smart enough
	expect(obj1.other.other === obj1).toBe(true);
	expect(obj2.other.other === obj2).toBe(true);
    });

    it("can free a reference chain", async () => {
	let w = world.World.create(1024);
	let a = w.createDictionary();
	let b = w.createDictionary();
	let c = w.createDictionary();
	let d = w.createDictionary();

	w.root().a = a;
	a.b = b;
	b.c = c;
	c.d = d;

	a = null;
	b = null;
	c = null;
	d = null;

	await testutil.forceGc();
	expect(w.objectCount()).toBe(4);

	delete w.root().a;
	await testutil.forceGc();
	expect(w.objectCount()).toBe(0);
    });

    it("can handle references to non-dictionaries", async () => {
	let w = world.World.create(1024);
	let obj = w.createDictionary();
	let latch = w.createLatch();  // Latch is chosen randomly

	obj.foo = latch;
	expect(obj.foo).toBe(latch);

	obj = null;
	latch = null;
	await testutil.forceGc();
	expect(w.objectCount()).toBe(0);
    });

    it("multi-threaded single-dictionary stress test", async () => {
	const NUM_WORKERS = 4;

	let w = world.World.create(10240);
	w.root().start = w.createLatch(1);

	let workers = new Array();
	for (let i = 0; i < NUM_WORKERS; i++) {
	    w.root()["latch_" + i] = w.createLatch(1);
	    workers.push(testutil.spawnWorker(
		w, "dictionary_spec_worker.js", "singleDictionaryStressTest",
		i, []));
	}

	let leftBefore = w.left();
	let objectCountBefore = w.objectCount();
	w.root().obj = w.createDictionary();

	w.root().start.dec();

	for (let i = 0; i < NUM_WORKERS; i++) {
	    w.root()["latch_" + i].wait();
	}

	delete w.root().obj;
	await testutil.forceGc();
	expect(w.objectCount()).toBe(objectCountBefore);
	expect(w.left()).toBe(leftBefore);
    });
});
