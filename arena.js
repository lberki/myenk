"use strict";

// TODO:
// - move freeStart to a field (will be shared with other threads)
// - Figure out why # private members don't work
// - Implement statistics (fragmentation, blocks, histogram, etc.)

const util = require("util");
const debuglog = util.debuglog("arena");

let sync_internal = require("./sync_internal.js");

const ARENA_HEADER_SIZE = 32;
const BLOCK_HEADER_SIZE = 8;
const MAGIC = 0xd1ce4011;

// Block header:
// 4 bytes: size of block (not including header)
// 4 bytes: (address of header of previous block << 1) | (1 if free, otherwise 0)

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

    asUint8() {
	return new Uint8Array(this._arena.bytes, this._base + BLOCK_HEADER_SIZE, this.size());
    }

    size() {
	return this._arena.uint32[this._base / 4];
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

	this._criticalSection = new sync_internal.CriticalSection(this.int32, 4);
	debuglog("created arena(size=%d)", bytes.byteLength - ARENA_HEADER_SIZE);

	this.alloc = this._criticalSection.wrap(this, this.allocLocked);
	this.free = this._criticalSection.wrap(this, this.freeLocked);
    }

    _init(size) {
	this.uint32[0] = MAGIC;  // Magic
	this.uint32[1] = 0;  // Start of freelist
	this.uint32[2] = this.bytes.byteLength - ARENA_HEADER_SIZE;  // free space left
	this.uint32[3] = ARENA_HEADER_SIZE;  // high water mark
	this.uint32[4] = 0;  // Lock
	this.uint32[5] = 0;  // Block with lowest address, 0 if none
	this.uint32[6] = 0;  // Block with highest address, 0 if none
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
		// Perfect match, remove from freelist
		this.uint32[prev / 4] = this.uint32[(next + BLOCK_HEADER_SIZE) / 4];

		// Flip free bit to zero
		this.uint32[next / 4 + 1] &= ~1;

		// Return the perfectly matched block
		return next;
	    } else if (nextSize >= size + BLOCK_HEADER_SIZE + 4) {  // 4: minimum alloc size
		// Larger block, cut it in half
		let secondHalf = next + size + BLOCK_HEADER_SIZE;

		// Set header of second, still unallocated half:
		// 1. Size (what is left after cutting the amount to be allocated)
		this.uint32[secondHalf / 4] = nextSize - size - BLOCK_HEADER_SIZE;

		// 2. Prev ptr (to the first half). Free bit is set.
		this.uint32[secondHalf / 4 + 1] = (next << 1) | 1;

		// 3. Update prev ptr in next block or arena last block ptr if last block is halved
		if (next === this.uint32[6]) {
		    this.uint32[6] = secondHalf;
		} else {
		    let afterNext = next + BLOCK_HEADER_SIZE + (this.uint32[next / 4] + 3) & ~3;
		    let afterNextFree = this.uint32[afterNext / 4 + 1] & 1;

		    // Keep free bit
		    this.uint32[afterNext / 4 + 1] = (secondHalf << 1) | afterNextFree;
		}

		// Flip free bit on the block we are about to return to zero
		this.uint32[next / 4 + 1] &= ~1;

		// Next ptr in the first half will be updated by caller (we can't do it here because
		// the allocation size may be rounded up)

		// Replace next in freelist with secondHalf.
		this.uint32[(secondHalf + BLOCK_HEADER_SIZE) / 4] =
		    this.uint32[(next + BLOCK_HEADER_SIZE) / 4];
		this.uint32[prev / 4] = secondHalf;

		return next;
	    } else {
		prev = next + BLOCK_HEADER_SIZE;  // Freelist is the first uint32 in the block
	    }
	}
    }

    _fromBump(allocSize) {
	let newBlock = this.uint32[3];
	if (newBlock + allocSize + BLOCK_HEADER_SIZE > this.bytes.byteLength) {
	    throw new Error("out of memory");
	}

	// Bump high water mark
	this.uint32[3] += allocSize + BLOCK_HEADER_SIZE;

	// Set lowest block address, if necessary
	if (this.uint32[5] === 0) {
	    this.uint32[5] = newBlock;
	}

	// Size is set by caller (the size we know is rounded up)

	// Set next block address in previous highest block, update highest block
	let prevHighest = this.uint32[6];
	this.uint32[6] = newBlock;

	// Set prev pointer in block header
	this.uint32[newBlock / 4 + 1] = prevHighest << 1;

	return newBlock;
    }

    fromAddr(addr) {
	return new Ptr(this, addr);
    }

    allocLocked(size) {
	let allocSize = (size + 3) & ~3;  // Round up to the nearest multiple of 4
	let newBlock  = this._fromFreeList(allocSize);
	if (newBlock !== null) {
	    debuglog("allocated %d bytes @ %d from freelist", size, newBlock);
	} else {
	    newBlock = this._fromBump(allocSize);
	    debuglog("allocated %d bytes @ %d by expansion", size, newBlock);
	}

	// Set size on the newly allocated block
	this.uint32[newBlock / 4] = size;

	// Decrease free byte count in header
	this.uint32[2] = this.uint32[2] - allocSize - BLOCK_HEADER_SIZE;

	return new Ptr(this, newBlock);
    }

    freeLocked(ptr) {
	let size = this.uint32[ptr._base / 4];
	let allocSize = (size + 3) & ~3;
	debuglog("freeing %d bytes @ %d", size, ptr._base);

	// Increase free byte count in header
	this.uint32[2] = this.uint32[2] + allocSize + BLOCK_HEADER_SIZE;

	// Put new block at the begining of the freelist¸link it in
	let oldFreelistHead = this.uint32[1];
	ptr.set32(0, oldFreelistHead);
	this.uint32[1] = ptr._base;

	// Set free bit to 1
	this.uint32[ptr._base / 4 + 1] |= 1;
    }

    left() {
	return this.uint32[2];
    }

    sanityCheck() {
	let sizes = [];
	let nextBlock = this.uint32[5];
	let lastBlock = 0;

	while (nextBlock < this.uint32[3]) {
	    let nextSize = this.uint32[nextBlock / 4];
	    let prevInBlock = this.uint32[nextBlock / 4 + 1] >> 1;
	    if (prevInBlock !== lastBlock) {
		throw new Error(
		    "block @ " + nextBlock + " has prev ptr " + prevInBlock + " not " + lastBlock);
	    }

	    sizes.push(nextSize);
	    lastBlock = nextBlock;
	    nextBlock += ((nextSize+3) & ~3) + BLOCK_HEADER_SIZE;
	}

	if (lastBlock !== this.uint32[6]) {
	    throw new Error("last block is " + lastBlock + " from header: " + this.uint32[6]);
	}

	if (this.uint32[3] !== nextBlock) {
	    throw new Error("high water mark is " + this.uint32[3] + " not " + nextBlock);
	}

	let freeBlock = this.uint32[1];
	while (freeBlock !== 0) {
	    if ((this.uint32[freeBlock / 4 + 1] & 1) !== 1) {
		throw new Error("free bit on block " + freeBlock + " is not set");
	    }

	    freeBlock = this.uint32[(freeBlock + BLOCK_HEADER_SIZE) / 4];
	}

	return sizes;
    }
}

exports.Arena = Arena;
exports.ARENA_HEADER_SIZE = ARENA_HEADER_SIZE;
exports.BLOCK_HEADER_SIZE = BLOCK_HEADER_SIZE;
