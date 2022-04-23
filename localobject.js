"use strict";

const util = require("util");
const debuglog = util.debuglog("localobject");

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

    _free() {
	this._arena.free(this._ptr);
    }
}

exports.LocalObject = LocalObject;
