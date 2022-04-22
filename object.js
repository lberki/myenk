"use strict";

// TODO:
// - Implement symbols as keys
// - Implement GC (and a linked list of every known object)
//   - Test the complicated WeakRef() system
// - Implement multiple threads
//   - Implement a lock / latch / etc.
//   - Wrap shared data structures (Arena + Object header) in a lock
//   - Test proxy creation in .get()
// - Implement more data types

// KNOWLEDGE BASE:
// - Float64Array for FP
// - Bigint manually
// - Symbol-to-sequence id bimap for Symbols

const util = require("util");
const debuglog = util.debuglog("object");

let ENCODER = new TextEncoder();

const Type = {
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

const ACTUAL = Symbol("Actual SharedObject");

// Representation:
// - pointer to properties (a linked list of (key, value, next) triplets)
// - <reserved for generation counter>
// - <reserved for an eventual lock>
// - <reserved for nr. of threads with a reference to this object>

// Linked list elements:
// - Pointer to next
// - Key (pointer to bytes)
// - Type
// - Value
class SharedObject {
    constructor(world, arena, ptr) {
	this._world = world;
	this._arena = arena;
	this._ptr = ptr;
	this._proxy = new WeakRef(new Proxy(this, handlers));
    }

    _init() {
	// No fields at the beginning
	this._ptr.set32(0, 0);

	// generation counter starts from 1 so as not to be confused with random zeroes
	this._ptr.set32(1, 1);
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

    _changeRefcount(objPtr, delta) {
	// TODO: acquire object lock
	// (and then make sure that the lock for another object is not held to avoid deadlocks)
	let oldRefcount = objPtr.get32(3);
	if (oldRefcount === 0) {
	    throw new Error("impossible");
	}

	objPtr.set32(3, oldRefcount + delta);
    }

    _freeValue(cellPtr) {
	let type = cellPtr.get32(2);
	if (type === Type.OBJECT) {
	    this._changeRefcount(this._arena.fromAddr(cellPtr.get32(3)), -1);
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
	this._arena.free(this._ptr);
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
	if (property === ACTUAL) {
	    // This is for internal use (ACTUAL is hidden from everyoen else)
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

	if (bufferType === Type.INTEGER) {
	    return bufferValue;
	} else if (bufferType == Type.OBJECT) {
	    return this._world._proxyFromAddr(bufferValue);
	} else {
	    throw new Error("not implemented");
	}
    }

    _set(property, value) {
	if (typeof(property) !== "string") {
	    throw new Error("not implemented");
	}

	let bufferType = -1, bufferValue = -1;
	if (value[ACTUAL] !== undefined) {
	    // An object under our control (maybe in a different world!)
	    if (value[ACTUAL]._world !== this._world) {
		throw new Error("not supported");
	    }

	    bufferType = Type.OBJECT;
	    bufferValue = value[ACTUAL]._ptr._base;
	    this._changeRefcount(value[ACTUAL]._ptr, 1);
	} else if (typeof(value) === "number" && value >= 0 && value < 1000) {
	    // TODO: support every 32-bit number
	    bufferType = Type.INTEGER;
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

    static _createNew(world, arena) {
	let ptr = arena.alloc(16);
	let obj = new SharedObject(world, arena, ptr);
	let proxy = obj._proxy.deref();

	obj._init();
	world._registerObject(obj, proxy, ptr._base);

	return proxy;
    }

    static _fromPtr(world, arena, ptr) {
	let obj = new SharedObject(world, arena, ptr);
	let proxy = obj._proxy.deref();
	world._registerObject(obj, proxy);

	// This thread now knows about this object, increase refcount
	// TODO: protect this with a lock once we have one
	ptr.set32(3, ptr.get32(3) + 1);
	return proxy;
    }
}

exports.SharedObject = SharedObject;
