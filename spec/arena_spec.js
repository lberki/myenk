"use strict";

var arena = require("../arena.js");

describe("arena", () => {
    it("exists", () => {
	expect(arena.Arena).not.toBeUndefined();
    });

    it("can allocate", () => {
	let cut = new arena.Arena(32);
	let ptr = cut.alloc(28);
	ptr.set32(0, 1);
	expect(ptr.get32(0)).toBe(1);
    });

    it("can reallocate freed block", () => {
	let cut = new arena.Arena(32);
	let ptr = cut.alloc(28);
	ptr.set32(2, 1);
	cut.free(ptr);
	ptr = cut.alloc(28);
	expect(ptr.get32(2)).toBe(1);
    });

    it("can halve freed block", () => {
	let cut = new arena.Arena(32);
	let ptr = cut.alloc(28);
	cut.free(ptr);
	let ptr1 = cut.alloc(12);
	let ptr2 = cut.alloc(12);
    });

    it("can skip block too small", () => {
	let cut = new arena.Arena(48);
	let small = cut.alloc(8);
	let large = cut.alloc(16);
	small.set32(1, 3);
	large.set32(1, 4);

	cut.free(large);
	cut.free(small);

	large = cut.alloc(16);
	small = cut.alloc(8);

	// Check if we got back the same blocks
	expect(large.get32(1)).toBe(4);
	expect(small.get32(1)).toBe(3);
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
