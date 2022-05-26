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

    it("can make other threads keep objects alive", async () => {
	let w = world.World.create(1024);
	let obj = { bar: "qux" };
	w.root().foo = obj;

	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "keepAliveTest", null,
	    ["removed", "gc", "replaced"]);
	t.wait("removed");
	obj = null;
	await testutil.forceGc();
	t.done("gc");
	t.wait("replaced");

	obj = w.root().foo2;
	expect(obj.bar).toBe("qux");
    });

    it("garbage collects object when other thread deletes reference", async () => {
	let w = world.World.create(1024);
	let obj = { bar: "qux" };
	let flag = false;
	let registry = new FinalizationRegistry(() => { flag = true; });
	registry.register(obj, null);
	w.root().foo = obj;
	obj = null;

	await testutil.forceGc();
	expect(w.objectCount()).toBe(1);  // The object just created
	expect(flag).toBeFalse();

	// The latch is handled explicitly so that we keep object count under control
	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "otherThreadDeletesReferenceTest", null,
	    ["removed"]);
	t.wait("removed");

	await testutil.forceGc();
	expect(w.objectCount()).toBe(2);  // Test latch dictionary + one latch
	expect(flag).toBeTrue();
    });

});
