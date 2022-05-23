"use strict";

let arena = require("./arena.js");
let sharedobject = require("./sharedobject.js");

// These are set when registering the object types for the world
let PRIVATE = null;
let BUFFER_TYPE = null;

// Plan:
// - keep a local object <-> address bimap in World
// - Special-case LocalObject in World and intern the object there before calling _init()
// - check the bimap in this._world if false, if not found, return a stub "bad idea" object
// - gc: on explicit call to a method on World. The bimap must keep a reference to the object
class LocalObject extends sharedobject.SharedObject {
    constructor(_world, _arena, _ptr) {
	super(_world, _arena, _ptr);
	// TODO
    }

    static _registerForWorld(privateSymbol, bufferType) {
	PRIVATE = privateSymbol;
	BUFFER_TYPE = bufferType;
    }

    _init() {
	super._init();
	this._setType(BUFFER_TYPE);
	// TODO
    }

    static _create(world, arena, ptr) {
	let priv = new LocalObject();
	return [null, priv];  // [public, private]
    }
}

exports.LocalObject = LocalObject;
