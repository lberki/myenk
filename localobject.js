"use strict";

const util = require("util");
const debuglog = util.debuglog("localobject");

let arena = require("./arena.js");
let sync_internal = require("./sync_internal.js");

let OBJECT_TYPE_BITS = 4;
let MAX_OBJECT_TYPE = (1 << OBJECT_TYPE_BITS) - 1;

// Representation:
// - Value (specific to object type)
// - Object type | (id << OBJECT_TYPE_BITS)
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

    static _getType(bits) {
	return bits & MAX_OBJECT_TYPE;
    }

    _init() {
	// Initial value is set by the actual object
	// Object type, likewise
	this._ptr.set32(2, 0);  // Lock
	// refcount is at address 3. The World is responsible for setting it.
    }

    _setType(type) {
	if (type < 0 || type > MAX_OBJECT_TYPE) {
	    throw new Error("impossible");
	}

	let masked = this._ptr.get32(1) & ~MAX_OBJECT_TYPE;
	this._ptr.set32(1, masked | type);
    }

    _setId(id) {
	let type = LocalObject._getType(this._ptr.get32(1));
	this._ptr.set32(1, (id << OBJECT_TYPE_BITS) + type);
    }

    _getId() {
	return this._ptr.get32(1) >> OBJECT_TYPE_BITS;
    }

    _free() {
	// Overridden by subclasses
    }
}

exports.LocalObject = LocalObject;
exports.MAX_OBJECT_TYPE = 0xf;
