"use strict";

let localobject = require("./localobject.js");

const UINT32_MAX = 4294967295;

// These are set when registering the object types for the world
let PRIVATE = null;
let LATCH_BUFFER_TYPE = null;

class LatchHandle {
    constructor(latch) {
	this[PRIVATE] = latch;
	Object.freeze(this);  // We can't serialize arbitary changes (Dictionary is for that)
    }

    dec() {
	this[PRIVATE]._dec();
    }

    wait() {
	this[PRIVATE]._wait();
    }
}

class Latch extends localobject.LocalObject {
    constructor(world, arena, ptr) {
	super(world, arena, ptr);

	this._ptr = ptr;
	this._int32 = arena.int32;
	this._addr = ptr._base / 4;
    }

    static _registerForWorld(privateSymbol, bufferType) {
	PRIVATE = privateSymbol;
	LATCH_BUFFER_TYPE = bufferType;
    }

    _init(n) {
	super._init();
	this._ptr.set32(1, LATCH_BUFFER_TYPE);
	this._ptr.set32(0, n);
    }

    static _create(world, arena, ptr) {
	let latch = new Latch(world, arena, ptr);
	return [latch, new LatchHandle(latch)];
    }

    _dec() {
	while (true) {
	    let old = Atomics.load(this._int32, this._addr);
	    if (old === 0) {
		throw new Error("latch cannot be decreased under zero");
	    }

	    let probe = Atomics.compareExchange(this._int32, this._addr, old, old-1);
	    if (probe === old) {
		// Successfully decreased while no one else did at the same time.
		if (old === 0) {
		    // We are the lucky thread that got the latch to zero. Tell everyone.
		    Atomics.notify(this._int32, this._addr);
		}
		return;

	    }
	}
    }

    _wait() {
	while (true) {
	    let old = Atomics.load(this._int32, this._addr);
	    if (old === 0) {
		// Latch is at zero. Return.
		return;
	    }

	    if (Atomics.wait(this._int32, this._addr, old) === "ok") {
		// Nothing happened between the load() and the wait() and the latch eventually
		// reached zero
		return;
	    }

	    // The latch was changed in between. Try again.
	}
    }
}

exports.Latch = Latch;
