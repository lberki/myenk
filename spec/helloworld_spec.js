"use strict";

var nostrum = require("../nostrum.js");

describe("The test suite", () => {
    it("values can be set", () => {
	let cut = nostrum.create();
	cut.foo = "bar";
	expect(cut.foo).toEqual("bar");
    });

    it("can check property presence", () => {
	let cut = nostrum.create();
	expect("foo" in cut).toBe(false);
	cut.foo = "bar";
	expect("foo" in cut).toBe(true);
	delete cut.foo;
	expect("foo" in cut).toBe(false);
    });
    
    it("has the top-level symbol", () => {
	expect(nostrum.create).not.toBeNull();
    });
    
    it("runs test cases", () => {
	expect(true).toBe(true);
    });
});
