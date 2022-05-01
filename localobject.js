"use strict";

const util = require("util");
const debuglog = util.debuglog("localobject");

let sync_internal = require("./sync_internal.js");

// Representation:
// - Value (specific to object type)
// - Object type
// - Object lock
// - Reference count (both in object graph and from threads)

class LocalObject {
    constructor(world, arena, ptr) {
	this._world = world;
	this._arena = arena;
	this._ptr = ptr;

	let csAddr = (this._ptr._base + arena.BLOCK_HEADER_SIZE) / 4 + 2;
	this._criticalSection = new sync_internal.CriticalSection(this._arena.int32, csAddr);
    }

    _cs(l) {
	this._criticalSection.run(l);
    }

    _init() {
	this._ptr.set32(2, 0);  // Lock
	// refcount is at address 3. The World is responsible for setting it.
    }

    _free() {
	this._arena.free(this._ptr);
    }
}

exports.LocalObject = LocalObject;
