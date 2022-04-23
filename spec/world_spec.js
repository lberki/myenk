"use strict";

let worker_threads = require("worker_threads");

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
});
