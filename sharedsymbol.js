"use strict";

let arena = require("./arena.js");
let sharedobject = require("./sharedobject.js");

// These are set when registering the object types for the world
let PRIVATE = null;
let BUFFER_TYPE = null;

// Value bits are:
// When not in dumpster: store pointer, LSB is 0
// When in dumpster: dumpster next pointer
//   - LSB == 1: object needs to be removed from maps
//   - LSB == 0: object is already removed from maps, only needs to be freed

// Memory layout:
// 32 bits: originating thread (by dumpster address)
// 32 bits: pointer to description string
class SharedSymbol extends sharedobject.SharedObject {
    constructor(_world, _arena, _ptr) {
	super(_world, _arena, _ptr);
    }

    static _registerForWorld(privateSymbol, bufferType) {
	PRIVATE = privateSymbol;
	BUFFER_TYPE = bufferType;
    }

    static _create(world, arena, ptr) {
	let priv = new SharedSymbol(world, arena, ptr);
	let pub = Symbol(); // TODO
	return [priv, pub];
    }

    _init() {
	super._init();
	this._setType(BUFFER_TYPE);
	let storePtr = this._arena.alloc(8);
	this._ptr.set32(0, storePtr._base);
	storePtr.set32(0, this._world._dumpster._base);
	storePtr.set32(1, 0);  // TODO: allocate string for description
    }

    _dumpsterAddr() {
	let storePtr = this._arena.fromAddr(this._ptr.get32(0));
	return storePtr.get32(0);
    }

    _free() {
	// Contract is that we must free anything that's not the object header, but we must keep
	// track of the dumpster this object belongs to. So move its address to the object header.
	let storePtr = this._arena.fromAddr(this._ptr.get32(0));
	// TODO: free description, once we have it
	this._ptr.set32(0, storePtr.get32(0));
	this._arena.free(storePtr);
	super._free();
    }
}

exports.SharedSymbol = SharedSymbol;
