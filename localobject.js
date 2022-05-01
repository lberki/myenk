"use strict";

const util = require("util");
const debuglog = util.debuglog("localobject");

let arena = require("./arena.js");
let sync_internal = require("./sync_internal.js");

// Representation:
// - Value (specific to object type)
// - Object type
// - Object lock
// - Reference count (both in object graph and from threads)

class LocalObject {
    constructor(_world, _arena, _ptr) {
	this._world = _world;
	this._arena = _arena;
	this._ptr = _ptr;

	this._criticalSection = new sync_internal.CriticalSection(
	    _arena.int32,
	    LocalObject._criticalSectionAddr(_ptr._base)
	);
    }

    static _criticalSectionAddr(base) {
	return (base + arena.BLOCK_HEADER_SIZE) / 4 + 2;
    }

    _init() {
	// Initial value is set by the actual object
	// Object type, likewise
	this._ptr.set32(2, 0);  // Lock
	// refcount is at address 3. The World is responsible for setting it.
    }

    _free() {
	this._arena.free(this._ptr);
    }
}

exports.LocalObject = LocalObject;
