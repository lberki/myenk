"use strict";

// TODO:
// - Add test case to make sure that three-long chain of objects is freed when not referenced
// - Implement symbols as keys
// - Implement GC (and a linked list of every known object)
//   - Test the complicated WeakRef() system
// - Implement multiple threads
//   - Implement object count in World
//   - Test buffer sharing on the same thread a bit more
//   - Implement a lock / latch / etc.
//   - Wrap shared data structures (Arena + Object header) in a lock
//   - Test proxy creation in .get()
// - Implement more JS data types

// KNOWLEDGE BASE:
// - Float64Array for FP
// - Bigint manually
// - Symbol-to-sequence id bimap for Symbols

const util = require("util");
const debuglog = util.debuglog("object");

let localobject = require("./localobject.js");

// These are set when registering the object type for the world
let PRIVATE = null;
let BUFFER_TYPE = null;

let ENCODER = new TextEncoder();

const ValueType = {
    INTEGER: 1,
    OBJECT: 2,
}

function handlerApply(target, thisArg, args) {
    throw new Error("impossible");
}

function handlerConstruct(target, args, newTarget) {
    throw new Error("not supported");
}

function handlerGetPrototypeOf(target) {
    throw new Error("not supported");
}

function handlerSetPrototypeOf(target, prototype) {
    throw new Error("not supported");
}

function handlerDefineProperty(target, key, descriptor) {
    throw new Error("not implemented");
}

function handlerGetOwnPropertyDescriptor(target, property) {
    throw new Error("not implemented");
}

function handlerIsExtensible(target) {
    throw new Error("not implemented");
}

function handlerPreventExtensions(target) {
    throw new Error("not implemented");
}

function handlerGet(target, property, receiver) {
    return target._get(property);
}

function handlerSet(target, property, value, receiver) {
    return target._set(property, value);
}

function handlerDeleteProperty(target, property) {
    return target._deleteProperty(property);
}

function handlerHas(target, property) {
    throw new Error("not implemented");
}

function handlerOwnKeys(target) {
    throw new Error("not implemented");
}

const handlers = {
    apply: handlerApply,
    construct: handlerConstruct,
    getPrototypeOf: handlerGetPrototypeOf,
    setPrototypeOf: handlerSetPrototypeOf,
    defineProperty: handlerDefineProperty,
    getOwnPropertyDescriptor: handlerGetOwnPropertyDescriptor,
    isExtensible: handlerIsExtensible,
    preventExtensions: handlerPreventExtensions,
    get: handlerGet,
    set: handlerSet,
    deleteProperty: handlerDeleteProperty,
    has: handlerHas,
    ownKeys: handlerOwnKeys
};

// "value" is a linked list of (key, value, next) triplets

// Linked list elements:
// - Pointer to next
// - Key (pointer to bytes)
// - Type
// - Value
class Dictionary extends localobject.LocalObject {
    constructor(world, arena, ptr) {
	super(world, arena, ptr);
    }

    static _registerForWorld(privateSymbol, bufferType) {
	PRIVATE = privateSymbol;
	BUFFER_TYPE = bufferType;
    }

    _init() {
	super._init();

	this._ptr.set32(1, BUFFER_TYPE);

	// No fields at the beginning
	this._ptr.set32(0, 0);
    }

    _freeValue(cellPtr) {
	let type = cellPtr.get32(2);
	if (type === ValueType.OBJECT) {
	    this._world._changeRefcount(this._arena.fromAddr(cellPtr.get32(3)), -1);
	}
    }

    _freeCell(cellPtr) {
	this._freeValue(cellPtr);

	this._arena.free(this._arena.fromAddr(cellPtr.get32(1)));  // Free key
	this._arena.free(cellPtr);  // Free cell
    }

    _free() {
	// Walk the property linked list and free each cell (and later, contents)
	let cell = this._ptr.get32(0);
	while (cell !== 0) {
	    let cellPtr = this._arena.fromAddr(cell);
	    cell = cellPtr.get32(0);
	    this._freeCell(cellPtr);
	}

	super._free();
    }

    _toBytes(s) {
	// TODO: handle Symbols. This is why this needs to be an instance method
	// TODO: Ths is ridiculously inefficient, both in RAM and CPU
	let textBytes = ENCODER.encode(s);
	let bytes = new Uint8Array(textBytes.length + 4);
	bytes[0] = textBytes.length >> 24;
	bytes[1] = (textBytes.length & 0xffffff) >> 16;
	bytes[2] = (textBytes.length & 0xffff) >> 8;
	bytes[3] = textBytes.length & 0xff;

	for (let i = 0; i < textBytes.length; i++) {
	    bytes[i+4] = textBytes[i];
	}

	return bytes;
    }

    _findProperty(bytes) {
	let prevPtr = this._ptr;
	while (true) {
	    let next = prevPtr.get32(0);
	    if (next === 0) {
		break;
	    }

	    let nextPtr = this._arena.fromAddr(next);
	    let keyPtr = this._arena.fromAddr(nextPtr.get32(1));
	    let ok = true;
	    for (let i = 0; i < bytes.length; i++) {
		if (keyPtr.get8(i) !== bytes[i]) {
		    ok = false;
		    break;
		}
	    }

	    if (ok) {
		return [prevPtr, nextPtr];
	    }

	    prevPtr = nextPtr;
	}

	return [null, null];
    }

    _get(property, value) {
	if (property === PRIVATE) {
	    // This is for internal use (PRIVATE is hidden from everyone else)
	    return this;
	}

	if (typeof(property) !== "string") {
	    throw new Error("not implemented");
	}

	let propBytes = this._toBytes(property);
	let [_, cellPtr] = this._findProperty(propBytes);
	if (cellPtr === null) {
	    return undefined;
	}

	let bufferType = cellPtr.get32(2);
	let bufferValue = cellPtr.get32(3);

	if (bufferType === ValueType.INTEGER) {
	    return bufferValue;
	} else if (bufferType == ValueType.OBJECT) {
	    return this._world._localFromAddr(bufferValue);
	} else {
	    throw new Error("not implemented");
	}
    }

    _set(property, value) {
	if (typeof(property) !== "string") {
	    throw new Error("not implemented");
	}

	let bufferType = -1, bufferValue = -1;
	if (value[PRIVATE] !== undefined) {
	    // An object under our control (maybe in a different world!)
	    if (value[PRIVATE]._world !== this._world) {
		throw new Error("not supported");
	    }

	    bufferType = ValueType.OBJECT;
	    bufferValue = value[PRIVATE]._ptr._base;
	    this._world._changeRefcount(value[PRIVATE]._ptr, 1);
	} else if (typeof(value) === "number" && value >= 0 && value < 1000) {
	    // TODO: support every 32-bit number
	    bufferType = ValueType.INTEGER;
	    bufferValue = value;
	} else {
	    throw new Error("not implemented");
	}

	let propBytes = this._toBytes(property);
	let [_, cellPtr] = this._findProperty(propBytes);
	if (cellPtr === null) {
	    // The property does not exist, allocate it

	    let keyPtr = this._arena.alloc((propBytes.length+3) & ~3);
	    for (let i = 0; i < propBytes.length; i++) {
		keyPtr.set8(i, propBytes[i]);
	    }

	    cellPtr = this._arena.alloc(16);
	    cellPtr.set32(1, keyPtr._base);

	    // Link in the new cell
	    cellPtr.set32(0, this._ptr.get32(0));
	    this._ptr.set32(0, cellPtr._base);
	} else {
	    this._freeValue(cellPtr);
	}

	cellPtr.set32(2, bufferType);
	cellPtr.set32(3, bufferValue);

	return true;
    }

    _deleteProperty(property) {
	let propBytes = this._toBytes(property);
	let [prevPtr, nextPtr] = this._findProperty(propBytes);

	if (prevPtr === null) {
	    return true;
	}

	// Unlink the cell and free it
	prevPtr.set32(0, nextPtr.get32(0));
	this._freeCell(nextPtr);
	return true;
    }

    static _create(world, arena, ptr) {
	let obj = new Dictionary(world, arena, ptr);
	let proxy = new Proxy(obj, handlers);

	return [obj, proxy];
    }
}

exports.Dictionary = Dictionary;
