"use strict";

// TODO:
// - Figure out why # private members don't work
// - Implement free() and a rudimentary freelist

const HEADER_SIZE = 16;

class Ptr {
    constructor(arena, base, size) {
	this._arena = arena;
	this._base = base;
    }

    _boundsCheck(i) {
	let size = this._arena.uint32[this._base / 4];
	if (i < 0 || i >= size) {
	    throw new Error("out of bounds");
	}         
    }
    
    get32(i) {
	this._boundsCheck(i*4);
	return this._arena.uint32[this._base / 4 + 1 + i];
    }

    set32(i, x) {
	this._boundsCheck(i*4);
	this._arena.uint32[this._base / 4 + 1 + i] = x;
    }
	
}

class Arena {
    constructor(size) {
	if (size % 16 != 0) {
	    throw new Error("size must be a multiple of 16");
	}
	
	this.bytes = new SharedArrayBuffer(HEADER_SIZE + size);
	this.uint32 = new Uint32Array(this.bytes);
	this.size = size;
	this.freeStart = HEADER_SIZE;
	this.freeEnd = HEADER_SIZE + size;
    }

    alloc(size) {
	if (size <= 0) {
	    throw new Error("invalid size");
	}
	
	let base = this.freeStart;
	if (base + size > this.freeEnd) {
	    throw new Error("out of memory");
	}

	this.freeStart += size;
	this.uint32[base / 4] = size;
	return new Ptr(this, base, size);
    }

    free(ptr) {
    }
}

let wtf = new Arena(16);

exports.Arena = Arena;
