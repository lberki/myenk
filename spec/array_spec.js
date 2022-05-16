"use strict";

let testutil = require("./testutil.js");
let world = require("../world.js");

describe("array", () => {
    it("exists", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
    });

    it("new one behaves reasonably", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	expect(a.length).toBe(0);
	expect(a[0]).toBe(undefined);
	expect(a["foo"]).toBe(undefined);
	expect(a[-1]).toBe(undefined);
	expect(a.at(-1)).toBe(undefined);
	expect(a[10]).toBe(undefined);
    });

    it("can set value", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	a[1] = 42;
	expect(a.length).toBe(2);
	expect(a[1]).toBe(42);
	expect(a.at(1)).toBe(42);
	expect(a.at("1")).toBe(42);
	expect(a[-1]).toBe(undefined);
	expect(a.at(-1)).toBe(undefined);
    });

    it("can extend backing store", async () => {
	let w = world.World.create(2048);
	let left = w.left();
	let a = w.createArray();

	for (let i = 0; i < 100; i++) {
	    a[i] = i + 1;
	    expect(a.length).toBe(i + 1);
	}

	for (let i = 0; i < 100; i++) {
	    expect(a[i]).toBe(i + 1);
	}

	a = null;
	await testutil.forceGc();
	expect(w.left()).toBe(left);
    });

    it("supports null value", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	a[0] = null;
	expect(a[0]).toBe(null);
	expect(a.length).toBe(1);
    });

    it("initializes elements to undefined", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	a[1] = 42;
	expect(a[0]).toBe(undefined);
	expect(a.length).toBe(2);
    });

    it("can deallocate backing store", async () => {
	let w = world.World.create(1024);
	let before = w.left();
	let a = w.createArray();
	a[32] = 0;
	expect(a.length).toBe(33);
	expect(w.left()).toBeLessThan(before);

	a = null;
	await testutil.forceGc();
	expect(w.left()).toBe(before);
    });

    it("supports simple object references", () => {
	let w = world.World.create(1024);
	let a = w.createArray();

	let dict = w.createDictionary();
	a[0] = dict;
	// Don't use expect(a[0]) because Jasmine apparently expects a lot of things from
	// objects passed to expect() we can't do yet
	// TODO: change it once Dictionary is smart enough
	expect(a[0] === dict).toBe(true);
    });

    it("keeps references to objects properly", async () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	a[0] = w.createDictionary();

	await testutil.forceGc();
	expect(w.objectCount()).toBe(2);
	expect(a[0]).not.toBe(undefined);

	a[0] = null;
	await testutil.forceGc();
	expect(w.objectCount()).toBe(1);
    });

    it("dereferences objects when freed", async () => {
	let w = world.World.create(1024);
	w.root().a = w.createArray();
	w.root().a[1] = w.createDictionary();

	await testutil.forceGc();
	expect(w.objectCount()).toBe(2);

	delete w.root().a;
	await testutil.forceGc();
	expect(w.objectCount()).toBe(0);
    });

    it("implements push()", () => {
	let w = world.World.create(1024);
	let a = w.createArray();

	a.push("a");
	expect(a.length).toBe(1);
	expect(a[0]).toBe("a");

	a.push("b", "c" ,"d");
	expect(a.length).toBe(4);
	expect(a[1]).toBe("b");
	expect(a[2]).toBe("c");
	expect(a[3]).toBe("d");
    });

    it("implements pop()", async () => {
	let w = world.World.create(1024);
	let left = w.left();
	let a = w.createArray();

	expect(a.pop()).toBe(undefined);
	expect(a.length).toBe(0);

	a.push("a", "b");

	expect(a.pop()).toBe("b");
	expect(a.length).toBe(1);

	expect(a.pop()).toBe("a");
	expect(a.length).toBe(0);

	expect(a.pop()).toBe(undefined);
	expect(a.length).toBe(0);

	let d = w.createDictionary();
	d.foo = 42;
	a.push(d);
	let d2 = a.pop(d);
	expect(d2.foo).toBe(42);

	d = null;
	d2 = null;
	a = null;
	await testutil.forceGc();
	expect(w.left()).toBe(left);
    });

    it("push/pop stress test", () => {
	const NUM_WORKERS = 4;

	let w = world.World.create(16384);
	w.root().start = w.createLatch(1);
	w.root().end = w.createLatch(NUM_WORKERS);
	w.root().array = w.createArray();

	let workers = new Array();
	for (let i = 0; i < NUM_WORKERS; i++) {
	    workers.push(testutil.spawnWorker(
		w, "array_spec_worker.js", "pushPopStressTest",
		i, []));
	}

	w.root().start.dec();
	w.root().end.wait();
	w.sanityCheck();
    });

    it("get/set stress test", async () => {
	const NUM_WORKERS = 4;

	let w = world.World.create(16384);
	w.root().start = w.createLatch(1);
	w.root().end = w.createLatch(NUM_WORKERS);

	let workers = new Array();
	for (let i = 0; i < NUM_WORKERS; i++) {
	    workers.push(testutil.spawnWorker(
		w, "array_spec_worker.js", "getSetStressTest",
		i, []));
	}

	let objectsBefore = w.objectCount();

	w.root().array = w.createArray();
	w.root().values = w.createArray();

	w.root().array[99] = undefined;
	for (let i = 0; i < 10; i++) {
	    w.root().values.push(w.createDictionary());
	}

	w.root().start.dec();
	w.root().end.wait();

	delete w.root().array;
	delete w.root().values;

	w.sanityCheck();
	await testutil.forceGc();
	expect(w.objectCount()).toBe(objectsBefore);
    });
});
