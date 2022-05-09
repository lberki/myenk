"use strict";

let testutil = require("./testutil.js");
let world = require("../world.js");

describe("array", () => {
    it("exists", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
    });

});
