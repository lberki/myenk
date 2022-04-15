"use strict";

// TODO:
// - Figure out why # private members don't work

const util = require("util");
const debuglog = util.debuglog("arena");

const ARENA_HEADER_SIZE = 16;
const BLOCK_HEADER_SIZE = 4;

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
	return this._arena.uint32[(this._base + BLOCK_HEADER_SIZE) / 4 + i];
    }

    set32(i, x) {
	this._boundsCheck(i*4);
	this._arena.uint32[(this._base + BLOCK_HEADER_SIZE) / 4 + i] = x;
    }
	
}

class Arena {
    constructor(size) {
	if (size % 16 !== 0) {
	    throw new Error("size must be a multiple of 16");
	}
	
	this.bytes = new SharedArrayBuffer(ARENA_HEADER_SIZE + size);
	this.uint32 = new Uint32Array(this.bytes);
	this.size = size;
	this.freeStart = ARENA_HEADER_SIZE;
	this.freeEnd = ARENA_HEADER_SIZE + size;

	this.uint32[0] = 0xd1ce4011;  // Magic
	this.uint32[1] = 0;           // Start of freelist

	debuglog("created arena(size=%d)", size);
    }

    _fromFreeList(size) {
	let prev = 4;  // Address of start of freelist

	while (true) {
	    let next = this.uint32[prev / 4];
	    if (next === 0) {
		return null;  // end of freelist, nothing found
	    }

	    let nextSize = this.uint32[next / 4];
	    if (nextSize === size) {
		// Perfect match, remove from freelist and return
		this.uint32[prev / 4] = this.uint32[(next + 4) / 4];
		return next;
	    } else if (nextSize >= size + BLOCK_HEADER_SIZE + 4) {
		// Larger block, cut it in half
		let secondHalf = next + size + BLOCK_HEADER_SIZE;
		this.uint32[secondHalf / 4] = nextSize - size - BLOCK_HEADER_SIZE;

		// Replace next in freelist with secondHalf
		this.uint32[(secondHalf + 4) / 4] = this.uint32[(next + 4) / 4];
		this.uint32[prev / 4] = secondHalf;

		return next;
	    } else {
		prev = next + 4;  // Freelist is the first uint32 in the block
	    }
	}
    }

    alloc(size) {
	if (size <= 0 || (size % 4) !== 0) {
	    throw new Error("invalid size");
	}

	let fromFreeList = this._fromFreeList(size);
	if (fromFreeList !== null) {
	    this.uint32[fromFreeList / 4] = size;
	    debuglog("allocated %d bytes @ %d from freelist", size, fromFreeList);
	    return new Ptr(this, fromFreeList, size);
	}
	
	let base = this.freeStart;
	if (base + size + BLOCK_HEADER_SIZE > this.freeEnd) {
	    throw new Error("out of memory");
	}

	this.freeStart += size + BLOCK_HEADER_SIZE;
	this.uint32[base / 4] = size;

	debuglog("allocated %d bytes @ %d by expansion", size, base);
	return new Ptr(this, base, size);
    }

    free(ptr) {
	debuglog("freeing %d bytes @ %d", this.uint32[ptr._base / 4], ptr._base);

	let oldFreelistHead = this.uint32[1];
	ptr.set32(0, oldFreelistHead);
	this.uint32[1] = ptr._base;
    }
}

exports.Arena = Arena;
