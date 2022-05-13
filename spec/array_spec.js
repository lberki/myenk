"use strict";

let testutil = require("./testutil.js");
let world = require("../world.js");

describe("array", () => {
    it("exists", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
    });

    it("new one has size 0", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	expect(a.length).toBe(0);
    });

    it("can set value", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	a[1] = 42;
	expect(a[1]).toBe(42);
    });
});
