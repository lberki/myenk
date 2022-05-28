"use strict";

let testutil = require("./testutil.js");
let world = require("../world.js");

describe("sharedsymbol", () => {
    it("passes smoke test", () => {
	let w = world.World.create(1024);
	let obj = Symbol("smoke test symbol");
	w.root().foo = obj;
	w.localSanityCheck();

	let t = testutil.spawnWorker(
	    w, "sharedsymbol_spec_worker.js", "smokeTest", null, ["moved"]);
	t.wait("moved");
	expect(w.root().bar).toBe(obj);
	w.localSanityCheck();
    });
});
