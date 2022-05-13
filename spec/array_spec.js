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

    it("supports null value", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	w[0] = null;
	expect(w[0]).toBe(null);
    });

    it("initializes elements to undefined", () => {
	let w = world.World.create(1024);
	let a = w.createArray();
	a[1] = 42;
	expect(a[0]).toBe(undefined);
    });

    it("can deallocate backing store", async () => {
	let w = world.World.create(1024);
	let before = w.left();
	let a = w.createArray();
	a[32] = 0;
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
});
