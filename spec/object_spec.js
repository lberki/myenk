"use strict";

let worker_threads = require("worker_threads");

let object = require("../object.js");
let world = require("../world.js");

// Resolves the promise in the next iteration of the event loop.
// Used to try to make sure garbage collection happens when expected. There are no official
// guarantees, but it seems to work and is useful for testing.
function nextEvent() {
    return new Promise(resolve => {
	setImmediate(() => { resolve(null) });
    });
}

// I have no idea why *two* event loop iterations need to happen before objects with weak references
// to them are finalized and their FinalizationRegistry handlers are called but that's demonstrably
// the case, at least in Node v16.14.2.
async function forceGc() {
    await nextEvent();
    global.gc();
    await nextEvent();
}

describe("object", () => {
    it("object smoke test", () => {
	let w = new world.World(1024);
	let obj = w.create(object.Dictionary);
	obj.foo = 3;
	expect(obj.foo).toBe(3);
    });

    it("can be freed", async () => {
	let w = new world.World(1024);
	let obj = w.create(object.Dictionary);
	obj = null;

	await forceGc();
	expect(w.arena.left()).toBe(1024);
    });

    it("can free property", async () => {
	let w = new world.World(1024);
	let obj = w.create(object.Dictionary);
	obj.foo = 2;
	obj.bar = 2;
	obj = null;

	await forceGc();
	expect(w.arena.left()).toBe(1024);
    });

    it("can free deleted property", async () => {
	let w = new world.World(1024);
	let obj = w.create(object.Dictionary);
	obj.foo = 2;
	delete obj.foo;
	obj = null;

	await forceGc();
	expect(w.arena.left()).toBe(1024);
    });

    it("can overwrite property", () => {
	let w = new world.World(1024);
	let obj = w.create(object.Dictionary);
	obj.foo = 3;
	obj.foo = 4;
	expect(obj.foo).toBe(4);
    });

    it("can delete property", () => {
	let w = new world.World(1024);
	let obj = w.create(object.Dictionary);
	obj.foo = 3;
	delete(obj.foo);
	expect(obj.foo).toBe(undefined);
    });

    it("increases refcount on object reference", async () => {
	let w = new world.World(1024);
	let obj1 = w.create(object.Dictionary);
	let obj2 = w.create(object.Dictionary);
	obj1.foo = obj2;
	obj2 = null;

	let leftBeforeGc = w.arena.left();
	await forceGc();
	expect(w.arena.left()).toBe(leftBeforeGc);
    });

    it("decreases refcount on change object refeence", async () => {
	let w = new world.World(1024);
	let obj1 = w.create(object.Dictionary);
	let obj2 = w.create(object.Dictionary);
	obj1.foo = obj2;
	obj2 = null;
	obj1.foo = 1;
	obj1 = null;

	await forceGc();
	expect(w.arena.left()).toBe(1024);
    });

    it("decreases refcount on delete object refeence", async () => {
	let w = new world.World(1024);
	let obj1 = w.create(object.Dictionary);
	let obj2 = w.create(object.Dictionary);
	obj1.foo = obj2;
	delete obj1.foo;
	obj1 = null;
	obj2 = null;

	await forceGc();
	expect(w.arena.left()).toBe(1024);
    });

    it("supports simple object references", () => {
	let w = new world.World(1024);
	let obj1 = w.create(object.Dictionary);
	let obj2 = w.create(object.Dictionary);
	obj1.foo = obj2;

	// Don't use expect(obj1.foo) because Jasmine apparently expects a lot of things from
	// objects passed to expect() we can't do yet
	// TODO: change it once Dictionary is smart enough
	expect(obj1.foo === obj2).toBe(true);
    });

    it("supports circular object references", () => {
	let w = new world.World(1024);
	let obj1 = w.create(object.Dictionary);
	let obj2 = w.create(object.Dictionary);

	obj1.other = obj2;
	obj2.other = obj1;

	// Don't use expect(obj1.foo) because Jasmine apparently expects a lot of things from
	// objects passed to expect() we can't do yet
	// TODO: change it once Dictionary is smart enough
	expect(obj1.other.other === obj1).toBe(true);
	expect(obj2.other.other === obj2).toBe(true);
    });

    it("multi-threaded smoke test", async () => {
	let w = new world.World(1024);
	let signal = new SharedArrayBuffer(4);
	let i = new Int32Array(signal);
	let t = new worker_threads.Worker("./spec/object_spec_worker.js", { workerData: {
	    func: "smokeTest",
	    signal: signal,
	    arena: w.arena.bytes,
	    size: w.arena.size,
	}});

	Atomics.wait(i, 0, 0, 100);
    });
});
