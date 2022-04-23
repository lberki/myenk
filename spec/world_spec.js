"use strict";

let worker_threads = require("worker_threads");

let dictionary = require("../dictionary.js");
let world = require("../world.js");

describe("world", () => {
    it("can share a buffer on the same thread", () => {
	let w = new world.World(1024);
    });
});
