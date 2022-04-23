"use strict";

let worker_threads = require("worker_threads");

let dictionary = require("../dictionary.js");
let world = require("../world.js");

describe("world", () => {
    it("has a root object", () => {
	let w = world.World.create(1024);
	w.root().foo = 1;
	expect(w.root().foo).toBe(1);
    });

    it("can share a buffer on the same thread", () => {
	let w = world.World.create(1024);
    });
});
