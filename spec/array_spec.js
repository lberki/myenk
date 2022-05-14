"use strict";

let testutil = require("./testutil.js");
let world = require("../world.js");

describe("array", () => {
    it("exists", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
    });

    it("new one behaves reasonably", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	expect(a.length).toBe(0);
	expect(a[0]).toBe(undefined);
	expect(a["foo"]).toBe(undefined);
	expect(a[-1]).toBe(undefined);
	expect(a.at(-1)).toBe(undefined);
	expect(a[10]).toBe(undefined);
    });

    it("can set value", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	a[1] = 42;
	expect(a.length).toBe(2);
	expect(a[1]).toBe(42);
	expect(a.at(1)).toBe(42);
	expect(a.at("1")).toBe(42);
	expect(a[-1]).toBe(undefined);
	expect(a.at(-1)).toBe(undefined);
    });

    it("can extend backing store", async () => {
	let w = world.World.create(2048);
	let left = w.left();
	let a = w.createArray();

	for (let i = 0; i < 100; i++) {
	    a[i] = i + 1;
	    expect(a.length).toBe(i + 1);
	}

	for (let i = 0; i < 100; i++) {
	    expect(a[i]).toBe(i + 1);
	}

	a = null;
	await testutil.forceGc();
	expect(w.left()).toBe(left);
    });

    it("supports null value", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	a[0] = null;
	expect(a[0]).toBe(null);
	expect(a.length).toBe(1);
    });

    it("initializes elements to undefined", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	a[1] = 42;
	expect(a[0]).toBe(undefined);
	expect(a.length).toBe(2);
    });

    it("can deallocate backing store", async () => {
	let w = world.World.create(1024);
	let before = w.left();
	let a = w.createArray();
	a[32] = 0;
	expect(a.length).toBe(33);
	expect(w.left()).toBeLessThan(before);

	a = null;
	await testutil.forceGc();
	expect(w.left()).toBe(before);
    });

    it("supports simple object references", () => {
	let w = world.World.create(1024);
	let a = w.createArray();

	let dict = w.createDictionary();
	a[0] = dict;
	// Don't use expect(a[0]) because Jasmine apparently expects a lot of things from
	// objects passed to expect() we can't do yet
	// TODO: change it once Dictionary is smart enough
	expect(a[0] === dict).toBe(true);
    });

    it("keeps references to objects properly", async () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	a[0] = w.createDictionary();

	await testutil.forceGc();
	expect(w.objectCount()).toBe(2);
	expect(a[0]).not.toBe(undefined);

	a[0] = null;
	await testutil.forceGc();
	expect(w.objectCount()).toBe(1);
    });

    it("dereferences objects when freed", async () => {
	let w = world.World.create(1024);
	w.root().a = w.createArray();
	w.root().a[1] = w.createDictionary();

	await testutil.forceGc();
	expect(w.objectCount()).toBe(2);

	delete w.root().a;
	await testutil.forceGc();
	expect(w.objectCount()).toBe(0);
    });

    it("implements push()", () => {
	let w = world.World.create(1024);
	let a = w.createArray();

	a.push("a");
	expect(a.length).toBe(1);
	expect(a[0]).toBe("a");

	a.push("b", "c" ,"d");
	expect(a.length).toBe(4);
	expect(a[1]).toBe("b");
	expect(a[2]).toBe("c");
	expect(a[3]).toBe("d");
    });
});
