"use strict";

var arena = require("../arena.js");

describe("arena", () => {
    it("exists", () => {
	expect(arena.Arena).not.toBeUndefined();
    });

    it("can allocate", () => {
	let cut = new arena.Arena(32);
	let ptr = cut.alloc(32);
	ptr.set32(0, 1);
	expect(ptr.get32(0)).toBe(1);
    });

    it("can throw OOM", () => {
	let cut = new arena.Arena(32);
	expect(() => { cut.alloc(64); }).toThrow();
    });
    
    it("can detect buffer underflow / overflow", () => {
	let cut = new arena.Arena(32);
	let ptr = cut.alloc(8);

	expect(() => { ptr.get32(-1) }).toThrow();
	expect(() => { ptr.get32(2) }).toThrow();	
    });
});
