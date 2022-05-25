"use strict";

let testutil = require("./testutil.js");
let world = require("../world.js");

describe("localobject", () => {
    it("passes smoke test", () => {
	let w = world.World.create(1024);
	let obj = {};
	w.root().foo = obj;
	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "smokeTest", null, ["moved"]);
	t.wait("moved");
	expect(w.root().bar).toBe(obj);
    });
});
