"use strict";

// TODO:
// - move freeStart to a field (will be shared with other threads)
// - Figure out why # private members don't work
// - Implement statistics (fragmentation, blocks, histogram, etc.)

const util = require("util");
const debuglog = util.debuglog("arena");

const ARENA_HEADER_SIZE = 16;
const BLOCK_HEADER_SIZE = 4;
const MAGIC = 0xd1ce4011;

class Ptr {
    constructor(arena, base) {
	this._arena = arena;
	this._base = base;
    }

    _boundsCheck(i) {
	let size = this._arena.uint32[this._base / 4];
	if (i < 0 || i >= size) {
	    throw new Error("out of bounds");
	}
    }

    get8(i) {
	this._boundsCheck(i);
	return this._arena.uint8[this._base + BLOCK_HEADER_SIZE + i];
    }

    set8(i, x) {
	this._boundsCheck(i);
	this._arena.uint8[this._base + BLOCK_HEADER_SIZE + i] = x;
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
    constructor(bytes) {
	this.bytes = bytes;
	this.uint32 = new Uint32Array(this.bytes);
	this.int32 = new Int32Array(this.bytes);
	this.uint8 = new Uint8Array(this.bytes);
	this.size = bytes.byteLength - ARENA_HEADER_SIZE;
	this.freeStart = ARENA_HEADER_SIZE;
	this.freeEnd = bytes.byteLength;

	debuglog("created arena(size=%d)", this.size);
    }

    _init(size) {
	this.uint32[0] = MAGIC;       // Magic
	this.uint32[1] = 0;           // Start of freelist
	this.uint32[2] = this.size;   // Free space left

	// TODO: put freeEnd here, too
    }

    static create(size) {
	if (size <= 16) {
	    throw new Error("invalid size");
	}

	let arena = new Arena(new SharedArrayBuffer(ARENA_HEADER_SIZE + size));

	arena._init();
	debuglog("created new arena(size=%d)", size);
	return arena;
    }

    static existing(sab) {
	let arena = new Arena(sab);
	if (arena.uint32[0] != MAGIC) {
	    throw new Error("invalid arena magic " + arena.uint32[0]);
	}

	debuglog("created arena from existing(size=%d)", arena.size);
	return arena;
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

    fromAddr(addr) {
	return new Ptr(this, addr);
    }

    alloc(size) {
	if (size <= 0 || (size % 4) !== 0) {
	    throw new Error("invalid size");
	}

	let fromFreeList = this._fromFreeList(size);
	if (fromFreeList !== null) {
	    this.uint32[fromFreeList / 4] = size;
	    debuglog("allocated %d bytes @ %d from freelist", size, fromFreeList);
	    this.uint32[2] = this.uint32[2] - size - BLOCK_HEADER_SIZE;
	    return new Ptr(this, fromFreeList);
	}

	let base = this.freeStart;
	if (base + size + BLOCK_HEADER_SIZE > this.freeEnd) {
	    throw new Error("out of memory");
	}

	this.freeStart += size + BLOCK_HEADER_SIZE;
	this.uint32[base / 4] = size;

	debuglog("allocated %d bytes @ %d by expansion", size, base);
	this.uint32[2] = this.uint32[2] - size - BLOCK_HEADER_SIZE;
	return new Ptr(this, base);
    }

    free(ptr) {
	let size = this.uint32[ptr._base / 4];
	debuglog("freeing %d bytes @ %d", size, ptr._base);
	this.uint32[2] = this.uint32[2] + size + BLOCK_HEADER_SIZE;
	let oldFreelistHead = this.uint32[1];
	ptr.set32(0, oldFreelistHead);
	this.uint32[1] = ptr._base;
    }

    left() {
	return this.uint32[2];
    }
}

exports.Arena = Arena;
exports.ARENA_HEADER_SIZE = ARENA_HEADER_SIZE;
exports.BLOCK_HEADER_SIZE = BLOCK_HEADER_SIZE;
