"use strict";

let arena = require("./arena.js");
let localobject = require("./localobject.js");
let sync_internal = require("./sync_internal.js");

const UINT32_MAX = 4294967295;

// These are set when registering the object types for the world
let PRIVATE = null;
let LATCH_BUFFER_TYPE = null;
let LOCK_BUFFER_TYPE = null;

class LockHandle {
    constructor(lock) {
	this[PRIVATE] = lock;
	Object.freeze(this);  // We can't serialize arbitrary changes (Dictionary is for that)
    }

    lock() {
	this[PRIVATE]._lock();
    }

    unlock() {
	this[PRIVATE]._unlock();
    }
}

class Lock extends localobject.LocalObject {
    constructor(_world, _arena, _ptr) {
	super(_world, _arena, _ptr);

	this._ptr = _ptr;
	this._int32 = _arena.int32;
	this._addr = (_ptr._base + arena.BLOCK_HEADER_SIZE) / 4;
    }

    static _registerForWorld(privateSymbol, bufferType) {
	PRIVATE = privateSymbol;
	LOCK_BUFFER_TYPE = bufferType;
    }

    _init(n) {
	super._init();
	this._setType(LOCK_BUFFER_TYPE);
	this._int32[this._addr] = Lock.FREE;
    }

    static _create(world, arena, ptr) {
	let lock = new Lock(world, arena, ptr);
	return [lock, new LockHandle(lock)];
    }

    _lock() {
	sync_internal.acquireLock(this._int32, this._addr);
    }


    _unlock() {
	sync_internal.releaseLock(this._int32, this._addr);
    }
}

class LatchHandle {
    constructor(latch) {
	this[PRIVATE] = latch;
	Object.freeze(this);  // We can't serialize arbitrary changes (Dictionary is for that)
    }

    dec() {
	this[PRIVATE]._dec();
    }

    wait() {
	this[PRIVATE]._wait();
    }
}

class Latch extends localobject.LocalObject {
    constructor(_world, _arena, _ptr) {
	super(_world, _arena, _ptr);

	this._ptr = _ptr;
	this._int32 = _arena.int32;
	this._addr = (_ptr._base + arena.BLOCK_HEADER_SIZE) / 4;
    }

    static _registerForWorld(privateSymbol, bufferType) {
	PRIVATE = privateSymbol;
	LATCH_BUFFER_TYPE = bufferType;
    }

    _init(n) {
	super._init();
	this._setType(LATCH_BUFFER_TYPE);
	this._ptr.set32(0, n);
    }

    static _create(world, arena, ptr) {
	let latch = new Latch(world, arena, ptr);
	return [latch, new LatchHandle(latch)];
    }

    _dec() {
	while (true) {
	    let old = Atomics.sub(this._int32, this._addr, 1);
	    if (old <= 0) {
		// If so, the latch is hosed but the code is buggy anyway so it does not matter
		throw new Error("latch cannot be decreased under zero");
	    }

	    if (old === 1) {
		// We are the lucky thread that got the latch to zero. Tell everyone.
		Atomics.notify(this._int32, this._addr);
	    }

	    // Haven't reached zero yet, move along
	    return;
	}
    }

    _wait() {
	while (true) {
	    let old = Atomics.load(this._int32, this._addr);
	    if (old === 0) {
		// Latch is at zero. Return.
		return;
	    }

	    let result = Atomics.wait(this._int32, this._addr, old, 2000);
	    if (result === "ok") {
		// Nothing happened between the load() and the wait() and the latch eventually
		// reached zero
		return;
	    } else if (result === "timed-out") {
		throw new Error("timeout");
	    }

	    // The latch was changed in between. Try again.
	}
    }
}

exports.Latch = Latch;
exports.Lock = Lock;
