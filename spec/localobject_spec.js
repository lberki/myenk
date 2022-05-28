"use strict";

let testutil = require("./testutil.js");
let world = require("../world.js");

describe("localobject", () => {
    it("passes smoke test", () => {
	let w = world.World.create(1024);
	let obj = {};
	w.root().foo = obj;
	w.sanityCheckLocal();

	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "smokeTest", null, ["moved"]);
	t.wait("moved");
	expect(w.root().bar).toBe(obj);
	w.sanityCheckLocal();
    });

    it("can make other threads keep objects alive", async () => {
	let w = world.World.create(1024);
	let obj = { bar: "qux" };
	w.root().foo = obj;

	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "keepAliveTest", null,
	    ["removed", "gc", "replaced"]);
	t.wait("removed");
	w.sanityCheckLocal();

	obj = null;
	await testutil.forceGc();
	w.sanityCheckLocal();

	t.done("gc");
	t.wait("replaced");

	obj = w.root().foo2;
	expect(obj.bar).toBe("qux");
	w.sanityCheckLocal();
    });

    it("garbage collects object when other thread deletes reference", async () => {
	let w = world.World.create(1024);
	let obj1 = { bar: "qux" };
	let obj2 = { bar2: "qux2" };
	let gcCount = 0;
	let registry = new FinalizationRegistry(() => { gcCount += 1; });
	registry.register(obj1, null);
	registry.register(obj2, null);


	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "otherThreadDeletesReferenceTest", null,
	    ["started", "set", "removed"]);
	t.wait("started");
	let left = w.left();
	let objectCount = w.objectCount();
	w.root().foo1 = obj1;
	w.root().foo2 = obj2;
	await testutil.forceGc();
	expect(gcCount).toBe(0);
	w.sanityCheckLocal();

	obj1 = null;
	obj2 = null;
	t.done("set");
	t.wait("removed");
	w.sanityCheckLocal();

	w.emptyDumpster();
	await testutil.forceGc();
	expect(w.objectCount()).toBe(objectCount);
	expect(w.left()).toBe(left);
	expect(gcCount).toBe(2);
	w.sanityCheckLocal();


	w.emptyDumpster();  // To make sure emptying an empty dumpster is no-op
	w.sanityCheckLocal();
    });

    it("can reuse object in dumpster", async () => {
	let w = world.World.create(1024);
	let obj1 = { bar: "qux" };
	let obj2 = { bar2: "qux2" };
	let gcCount = 0;
	let registry = new FinalizationRegistry(() => { gcCount += 1; });
	registry.register(obj1, null);
	registry.register(obj2, null);
	w.root().foo1 = obj1;
	w.root().foo2 = obj2;
	w.sanityCheckLocal();

	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "reuseObjectInDumpsterTest", null,
	    ["removed"]);
	t.wait("removed");
	w.sanityCheckLocal();


	w.root().bar1 = obj1;
	w.root().bar2 = obj2;
	w.sanityCheckLocal();


	delete w.root().bar1;
	delete w.root().bar2;
	obj1 = null;
	obj2 = null;

	w.emptyDumpster();
	await testutil.forceGc();
	expect(w.objectCount()).toBe(2);  // Test latch dictionary + one latch
	expect(gcCount).toBe(2);
	w.sanityCheckLocal();

	w.emptyDumpster();  // To make sure emptying an empty dumpster is no-op
	w.sanityCheckLocal();
    });

});
