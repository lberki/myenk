"use strict";

let object = require("../object.js");
let world = require("../world.js");

describe("object", () => {
    it("object smoke test", () => {
	let w = new world.World(1024);
	let obj = w.create();
	obj.foo = 3;
	expect(obj.foo).toBe(3);
    });
});
