"use strict";

// Representation:
// - Value (specific to object type)
// - Object type
// - <reserved for object lock>
// - Reference count (both in object graph and from threads)

class LocalObject {
    constructor(world, arena, ptr) {
	this._world = world;
	this._arena = arena;
	this._ptr = ptr;
    }

    _init() {
	this._ptr.set32(2, 0);
	this._ptr.set32(3, 1);  // Only this thread knows about this object for now
    }

    _dispose() {
	let ptr = this._ptr;

	// TODO: protect this with a lock once we have one
	let newRefcount = ptr.get32(3) - 1;
	ptr.set32(3, newRefcount);
	this._world._deregisterObject(ptr._base);

	if (newRefcount == 0) {
	    this._free();
	}
    }

    _free() {
	this._arena.free(this._ptr);
    }
}

exports.LocalObject = LocalObject;
