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

    it("can overwrite property", () => {
	let w = new world.World(1024);
	let obj = w.create();
	obj.foo = 3;
	obj.foo = 4;
	expect(obj.foo).toBe(4);
    });

    it("can delete property", () => {
	let w = new world.World(1024);
	let obj = w.create();
	obj.foo = 3;
	delete(obj.foo);
	expect(obj.foo).toBe(undefined);
    });

    it("supports simple object references", () => {
	let w = new world.World(1024);
	let obj1 = w.create();
	let obj2 = w.create();
	obj1.foo = obj2;

	// Don't use expect(obj1.foo) because Jasmine apparently expects a lot of things from
	// objects passed to expect() we can't do yet
	// TODO: change it once SharedObject is smart enough
	expect(obj1.foo === obj2).toBe(true);
    });

    it("supports circular object references", () => {
	let w = new world.World(1024);
	let obj1 = w.create();
	let obj2 = w.create();

	obj1.other = obj2;
	obj2.other = obj1;

	// Don't use expect(obj1.foo) because Jasmine apparently expects a lot of things from
	// objects passed to expect() we can't do yet
	// TODO: change it once SharedObject is smart enough
	expect(obj1.other.other === obj1).toBe(true);
	expect(obj2.other.other === obj2).toBe(true);
    });
});
