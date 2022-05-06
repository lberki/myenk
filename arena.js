"use strict";

// TODO:
// - Figure out why # private members don't work
// - Implement statistics (fragmentation, blocks, histogram, etc.)

const util = require("util");
const debuglog = util.debuglog("arena");

let sync_internal = require("./sync_internal.js");

const ARENA_HEADER_SIZE = 32;
const BLOCK_HEADER_SIZE = 8;
const MIN_ALLOC_SIZE = 8;
const MAGIC = 0xd1ce4011;
const EXTENDED_SANITY_CHECKS = true;

const HEADER = {
    "MAGIC": 0,
    "FREELIST_HEAD": 1,
    "BYTES_LEFT": 2,
    "HIGH_WATER_MARK": 3,
    "LOCK": 4,
    "LOWEST_BLOCK": 5,
    "HIGHEST_BLOCK": 6,
}
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

function roundUp(size) {
    return (size + MIN_ALLOC_SIZE - 1) & ~(MIN_ALLOC_SIZE-1);
}

class Arena {
    constructor(bytes) {
	this.bytes = bytes;
	this.uint32 = new Uint32Array(this.bytes);
	this.int32 = new Int32Array(this.bytes);
	this.uint8 = new Uint8Array(this.bytes);

	this._criticalSection = new sync_internal.CriticalSection(this.int32, HEADER.LOCK);
	debuglog("created arena(size=%d)", bytes.byteLength - ARENA_HEADER_SIZE);

	this.alloc = this._criticalSection.wrap(this, this._allocLocked);
	this.free = this._criticalSection.wrap(this, this._freeLocked);
    }

    _init(size) {
	this.uint32[HEADER.MAGIC] = MAGIC;  // Magic
	this.uint32[HEADER.FREELIST_HEAD] = 0;  // Start of freelist
	this.uint32[HEADER.BYTES_LEFT] = this.bytes.byteLength - ARENA_HEADER_SIZE;  // free space left
	this.uint32[HEADER.HIGH_WATER_MARK] = ARENA_HEADER_SIZE;  // high water mark
	this.uint32[HEADER.LOCK] = 0;  // Lock
	this.uint32[HEADER.LOWEST_BLOCK] = 0;  // Block with lowest address, 0 if none
	this.uint32[HEADER.HIGHEST_BLOCK] = 0;  // Block with highest address, 0 if none
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
	if (arena.uint32[HEADER.MAGIC] != MAGIC) {
	    throw new Error("invalid arena magic " + arena.uint32[HEADER.MAGIC]);
	}

	debuglog("created arena from existing(size=%d)", arena.size);
	return arena;
    }

    _unlinkFromFreeList(addr) {
	let next = this.uint32[(addr + BLOCK_HEADER_SIZE) / 4];
	let prevBlock = this.uint32[(addr + BLOCK_HEADER_SIZE) / 4 + 1];
	let prevAddr = prevBlock == 0 ? 4 : prevBlock + BLOCK_HEADER_SIZE;

	// Forward link
	this.uint32[prevAddr / 4] = next;

	if (next !== 0) {
	    // Backward link
	    this.uint32[(next + BLOCK_HEADER_SIZE) / 4 + 1] = prevBlock;
	}
    }

    _fromFreeList(size) {
	let prevBlock = 0;  // Previous block on freelist (0: header)

	while (true) {
	    // Address of next pointer in the previous block or the header
	    let prevAddr = prevBlock == 0 ? 4 : prevBlock + BLOCK_HEADER_SIZE;
	    let next = this.uint32[prevAddr / 4];
	    if (next === 0) {
		return null;  // end of freelist, nothing found
	    }

	    let nextSize = this.uint32[next / 4];

	    if (nextSize === size) {
		// Perfect match, remove from freelist
		this._unlinkFromFreeList(next);

		// Flip free bit to zero
		this.uint32[next / 4 + 1] &= ~1;

		// Return the perfectly matched block
		return next;
	    } else if (nextSize >= size + BLOCK_HEADER_SIZE + MIN_ALLOC_SIZE) {
		// Larger block, cut it in half
		let secondHalf = next + size + BLOCK_HEADER_SIZE;

		// Set header of second, still unallocated half
		// 1. Size (what is left after cutting the amount to be allocated)
		this.uint32[secondHalf / 4] = nextSize - size - BLOCK_HEADER_SIZE;

		// 2. Prev ptr (to the first half). Free bit is set.
		this.uint32[secondHalf / 4 + 1] = (next << 1) | 1;

		// 3. Update prev ptr in next block or arena last block ptr if last block is halved
		if (next === this.uint32[HEADER.HIGHEST_BLOCK]) {
		    this.uint32[HEADER.HIGHEST_BLOCK] = secondHalf;
		} else {
		    let afterNext = next + BLOCK_HEADER_SIZE + roundUp(this.uint32[next / 4]);
		    let afterNextFree = this.uint32[afterNext / 4 + 1] & 1;

		    // Keep free bit
		    this.uint32[afterNext / 4 + 1] = (secondHalf << 1) | afterNextFree;
		}

		// Flip free bit on the block we are about to return to zero
		this.uint32[next / 4 + 1] &= ~1;

		// Next ptr in the first half will be updated by caller (we can't do it here because
		// the allocation size may be rounded up)

		// Replace block in freelist with secondHalf
		let afterNext = this.uint32[(next + BLOCK_HEADER_SIZE) / 4];

		// Forward pointer in secondHalf
		this.uint32[(secondHalf + BLOCK_HEADER_SIZE) / 4] = afterNext;

		// Backward pointer in secondHalf.
		this.uint32[(secondHalf + BLOCK_HEADER_SIZE) / 4 + 1] = prevBlock;

		// Forward pointer in previous block on freelist
		this.uint32[prevAddr / 4] = secondHalf;

		if (afterNext !== 0) {
		    // Backward pointer in next block on freelist
		    this.uint32[(afterNext + BLOCK_HEADER_SIZE) / 4 + 1] = secondHalf;
		}

		return next;
	    } else {
		prevBlock = next;
	    }
	}
    }

    _fromBump(allocSize) {
	let newBlock = this.uint32[HEADER.HIGH_WATER_MARK];
	if (newBlock + allocSize + BLOCK_HEADER_SIZE > this.bytes.byteLength) {
	    throw new Error("out of memory");
	}

	// Bump high water mark
	this.uint32[HEADER.HIGH_WATER_MARK] += allocSize + BLOCK_HEADER_SIZE;

	// Set lowest block address, if necessary
	if (this.uint32[HEADER.LOWEST_BLOCK] === 0) {
	    this.uint32[HEADER.LOWEST_BLOCK] = newBlock;
	}

	// Size is set by caller (the size we know is rounded up)

	// Set next block address in previous highest block, update highest block
	let prevHighest = this.uint32[HEADER.HIGHEST_BLOCK];
	this.uint32[HEADER.HIGHEST_BLOCK] = newBlock;

	// Set prev pointer in block header
	this.uint32[newBlock / 4 + 1] = prevHighest << 1;

	return newBlock;
    }

    fromAddr(addr) {
	return new Ptr(this, addr);
    }

    _allocLocked(size) {
	if (EXTENDED_SANITY_CHECKS) {
	    this.sanityCheck();
	}

	let allocSize = roundUp(size);
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
	this.uint32[HEADER.BYTES_LEFT] = this.uint32[HEADER.BYTES_LEFT] -
	    allocSize - BLOCK_HEADER_SIZE;

	if (EXTENDED_SANITY_CHECKS) {
	    this.sanityCheck();
	}

	return new Ptr(this, newBlock);
    }

    _mergeBlocks(prev, next) {
	let prevAllocSize = roundUp(this.uint32[prev / 4]);
	let nextAllocSize = roundUp(this.uint32[next / 4]);
	let newSize = prevAllocSize + nextAllocSize + BLOCK_HEADER_SIZE;
	debuglog("merging blocks at " + prev + " and " + next + ", new size is " + newSize);
	this.uint32[prev / 4] = newSize;
	this._unlinkFromFreeList(next);

	if (next !== this.uint32[HEADER.HIGHEST_BLOCK]) {
	    // Set the prev pointer of the block after next to prev
	    let afterNext = next + nextAllocSize + BLOCK_HEADER_SIZE;
	    this.uint32[afterNext / 4 + 1] = prev << 1;
	} else {
	    // The last block was merged away. Update header.
	    this.uint32[HEADER.HIGHEST_BLOCK] = prev;
	}
    }

    _freeLocked(ptr) {
	if (EXTENDED_SANITY_CHECKS) {
	    this.sanityCheck();
	}

	let size = this.uint32[ptr._base / 4];
	let allocSize = roundUp(size);
	debuglog("freeing %d bytes @ %d", size, ptr._base);

	// Increase free byte count in header
	this.uint32[HEADER.BYTES_LEFT] = this.uint32[HEADER.BYTES_LEFT] +
	    allocSize + BLOCK_HEADER_SIZE;

	// Put new block at the beginning of the freelist¸ link it in
	let oldFreelistHead = this.uint32[HEADER.FREELIST_HEAD];
	let base = ptr._base;

	// Forward link to old head
	this.uint32[(base + BLOCK_HEADER_SIZE) / 4] = oldFreelistHead;

	// Backward link from here to head (nowhere)
	this.uint32[(base + BLOCK_HEADER_SIZE) / 4 + 1] = 0;


	if (oldFreelistHead !== 0) {
	    // Backward link from old head
	    this.uint32[(oldFreelistHead + BLOCK_HEADER_SIZE) / 4 + 1] = base;
	}

	// New head (this block)
	this.uint32[HEADER.FREELIST_HEAD] = base;

	// Set free bit to 1
	this.uint32[base / 4 + 1] |= 1;

	// Merge free blocks after this one
	while (true) {
	    let allocSize = roundUp(this.uint32[base / 4]);
	    let nextBlock = base + allocSize + BLOCK_HEADER_SIZE;
	    if (nextBlock >= this.uint32[HEADER.HIGH_WATER_MARK]) {
		// This was the last block. The condition should theoretically be "==", but let's
		// not get in an infinite loop if not everything works perfectly
		break;
	    }

	    if ((this.uint32[nextBlock / 4 + 1] & 1) !== 1) {
		// Next block is not free
		break;
	    }

	    this._mergeBlocks(base, nextBlock);
	}

	// Merge free blocks before this one
	while (true) {
	    let prevBlock = this.uint32[(base / 4) + 1] >> 1;
	    if (prevBlock === 0) {
		// This was the first block
		break;
	    }

	    if ((this.uint32[prevBlock / 4 + 1] & 1) !== 1) {
		// Prev block is not free
		break;
	    }

	    this._mergeBlocks(prevBlock, base);
	    base = prevBlock;
	}

	if (EXTENDED_SANITY_CHECKS) {
	    this.sanityCheck();
	}
    }

    left() {
	return this.uint32[HEADER.BYTES_LEFT];
    }

    sanityCheck() {
	let sizes = [];
	let nextBlock = this.uint32[HEADER.LOWEST_BLOCK];
	let lastBlock = 0;
	let blocksWithFreeBit = 0;

	if (this.uint32[HEADER.LOWEST_BLOCK] === 0) {
	    return;
	}

	let lastFree = false;

	while (nextBlock < this.uint32[HEADER.HIGH_WATER_MARK]) {
	    let nextSize = this.uint32[nextBlock / 4];
	    let prevInBlock = this.uint32[nextBlock / 4 + 1] >> 1;
	    let thisFree = (this.uint32[nextBlock / 4 + 1] & 1) === 1;

	    if (thisFree && lastFree) {
		throw new Error("subsequent blocks " + lastBlock + " and " + nextBlock +
				" are both free");
	    }

	    if (this.uint32[nextBlock /4 + 1] & 1) {
		blocksWithFreeBit += 1;
	    }

	    if (prevInBlock !== lastBlock) {
		throw new Error("block @ " + nextBlock + " has prev ptr " + prevInBlock + " not " +
				lastBlock + " hwm is " + this.uint32[HEADER.HIGH_WATER_MARK]);
	    }

	    sizes.push(nextSize);
	    lastBlock = nextBlock;
	    nextBlock += roundUp(nextSize) + BLOCK_HEADER_SIZE;
	}

	if (lastBlock !== this.uint32[HEADER.HIGHEST_BLOCK]) {
	    throw new Error("last block is " + lastBlock + " from header: " +
			    this.uint32[HEADER.HIGHEST_BLOCK]);
	}

	if (this.uint32[HEADER.HIGH_WATER_MARK] !== nextBlock) {
	    throw new Error("high water mark is " + this.uint32[HEADER.HIGH_WATER_MARK] +
			    " not " + nextBlock);
	}

	let freeBlock = this.uint32[HEADER.FREELIST_HEAD];
	let freeListLength = 0;
	let prev = 0;

	while (freeBlock !== 0) {
	    freeListLength += 1;

	    if ((this.uint32[freeBlock / 4 + 1] & 1) !== 1) {
		throw new Error("free bit on block " + freeBlock + " is not set");
	    }

	    let prevInBlock = this.uint32[(freeBlock + BLOCK_HEADER_SIZE) / 4 + 1];
	    if (prevInBlock !== prev) {
		throw new Error("invalid backward link in freelist, " +
				prevInBlock + " instead of " + prev + " @ " + freeBlock);
	    }

	    prev = freeBlock;
	    freeBlock = this.uint32[(freeBlock + BLOCK_HEADER_SIZE) / 4];
	}

	if (freeListLength !== blocksWithFreeBit) {
	    throw new Error("freelist length is " + freeListLength + " but " +
			    blocksWithFreeBit + " blocks with the free bit set");
	}

	return sizes;
    }
}

exports.Arena = Arena;
exports.ARENA_HEADER_SIZE = ARENA_HEADER_SIZE;
exports.BLOCK_HEADER_SIZE = BLOCK_HEADER_SIZE;
