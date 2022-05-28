"use strict";

let testutil = require("./testutil.js");
let world = require("../world.js");

describe("localobject", () => {
    it("passes smoke test", () => {
	let w = world.World.create(1024);
	let obj = {};
	w.root().foo = obj;
	w.localSanityCheck();

	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "smokeTest", null, ["moved"]);
	t.wait("moved");
	expect(w.root().bar).toBe(obj);
	w.localSanityCheck();
    });

    it("throws on other thread", () => {
	let w = world.World.create(1024);
	let obj = { foo: "bar" };
	w.root().foo = obj;

	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "throwOnOtherThreadTest", null, ["referenced"]);
	t.wait("referenced");
	expect(w.root().thrown).toBe(true);
    });

    it("can make other threads keep objects alive", async () => {
	let w = world.World.create(1024);
	let obj = { bar: "qux" };
	w.root().foo = obj;

	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "keepAliveTest", null,
	    ["removed", "gc", "replaced"]);
	t.wait("removed");
	w.localSanityCheck();

	obj = null;
	await testutil.forceGc();
	w.localSanityCheck();

	t.done("gc");
	t.wait("replaced");

	obj = w.root().foo2;
	expect(obj.bar).toBe("qux");
	w.localSanityCheck();
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
	w.localSanityCheck();

	obj1 = null;
	obj2 = null;
	t.done("set");
	t.wait("removed");
	w.localSanityCheck();

	w.emptyDumpster();
	await testutil.forceGc();
	expect(w.objectCount()).toBe(objectCount);
	expect(w.left()).toBe(left);
	expect(gcCount).toBe(2);
	w.localSanityCheck();


	w.emptyDumpster();  // To make sure emptying an empty dumpster is no-op
	w.localSanityCheck();
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
	w.localSanityCheck();

	let t = testutil.spawnWorker(
	    w, "localobject_spec_worker.js", "reuseObjectInDumpsterTest", null,
	    ["removed"]);
	t.wait("removed");
	w.localSanityCheck();


	w.root().bar1 = obj1;
	w.root().bar2 = obj2;
	w.localSanityCheck();


	delete w.root().bar1;
	delete w.root().bar2;
	obj1 = null;
	obj2 = null;

	w.emptyDumpster();
	await testutil.forceGc();
	expect(w.objectCount()).toBe(2);  // Test latch dictionary + one latch
	expect(gcCount).toBe(2);
	w.localSanityCheck();

	w.emptyDumpster();  // To make sure emptying an empty dumpster is no-op
	w.localSanityCheck();
    });

});
