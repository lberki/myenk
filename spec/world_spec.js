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

	let before = w1.left();
	let obj = w2.root().foo;
	delete w1.root().foo;

	await testutil.forceGc();
	let after = w1.left();

	expect(w1.left()).toBeLessThan(1024);

	obj = null;
	await testutil.forceGc();
	expect(w1.left()).toBe(1024);
    });
});
