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

function handlerInvalid(...args) {
    throw new Error("attempted access to object in other thread");
}

function handlerGet(target, property) {
    if (property === PRIVATE) {
	return target;
    }

    handlerInvalid(target, property);
}

const handlers = {
    apply: handlerInvalid,
    construct: handlerInvalid,
    getPrototypeOf: handlerInvalid,
    setPrototypeOf: handlerInvalid,
    defineProperty: handlerInvalid,
    getOwnPropertyDescriptor: handlerInvalid,
    isExtensible: handlerInvalid,
    preventExtensions: handlerInvalid,
    get: handlerGet,
    set: handlerInvalid,
    deleteProperty: handlerInvalid,
    has: handlerInvalid,
    ownKeys: handlerInvalid,
};

// Memory layout:
// 32 bits: originating thread (by dumpster address)
// 32 bits: === 1 if object has not been garbage collected
class LocalObject extends sharedobject.SharedObject {
    constructor(_world, _arena, _ptr) {
	super(_world, _arena, _ptr);

	this._ownThread = false;
    }

    static _registerForWorld(privateSymbol, bufferType) {
	PRIVATE = privateSymbol;
	BUFFER_TYPE = bufferType;
    }

    static _create(world, arena, ptr) {
	let priv = new LocalObject(world, arena, ptr);
	let pub = new Proxy(priv, handlers);
	return [priv, pub];
    }

    _init() {
	super._init();
	this._setType(BUFFER_TYPE);
	this._ownThread = true;
	let storePtr = this._arena.alloc(8);
	this._ptr.set32(0, storePtr._base);
	storePtr.set32(0, this._world._dumpster._base);
	storePtr.set32(1, 1);
    }

    _dumpsterAddr() {
	return 0;  // TODO: remove, test

	let storePtr = this._arena.fromAddr(this._ptr.get32(0));
	return storePtr.get32(0);
    }

    _nextDumpsterAddr() {
	let storePtr = this._arena.fromAddr(this._ptr.get32(0));
	return storePtr.get32(1);
    }

    _free() {
	let storePtr = this._arena.fromAddr(this._ptr.get32(0));
	let dumpsterAddr = storePtr.get32(0);
	this._arena.free(storePtr);
	super._free();
    }
}

exports.LocalObject = LocalObject;
