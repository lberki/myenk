"use strict";

// FORMAT:
// - generation counter (int32 is plenty, I guess?)
// - linked list of (ptr to property name, ptr to property value)
// - each property is a separate biock (or maybe two for name / value)
// - Cache (Map or just object) of property addresses, invalidated on generation change

// TODO:
// - Deallocate memory when deleting a property (GC is only at the object level)
// - Implement more data types
// - Implement symbols as keys

// KNOWLEDGE BASE:
// - Float64Array for FP
// - Bigint manually
// - Symbol-to-sequence id bimap for Symbols
// - --expose-gc exposes global.gc() for debugging

const util = require("util");
const debuglog = util.debuglog("object");

let ENCODER = new TextEncoder();

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
	ptr.set32(3, ptr.get32(3) - 1);
	this._world._deregisterObject(ptr._base);
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

	return cellPtr.get32(3);
    }

    _set(property, value) {
	if (typeof(property) !== "string") {
	    throw new Error("not implemented");
	}

	if (typeof(value) !== "number" || value < 0 || value > 1000) {
	    // TODO: this is ridiculously arbitrary
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

	}

	cellPtr.set32(3, value);  // We don't care about the type for now

	return true;
    }

    _deleteProperty(property) {
	let propBytes = this._toBytes(property);
	let [prevPtr, nextPtr] = this._findProperty(propBytes);

	if (prevPtr === null) {
	    return true;
	}

	// TODO: maybe free nexPtr? Or leave that to GC, which will eventually exist?
	prevPtr.set32(0, nextPtr.get32(0));
	return true;
    }

    static _createNew(world, arena) {
	let ptr = arena.alloc(16);
	let obj = new SharedObject(world, arena, ptr);
	let proxy = new Proxy(obj, handlers);

	obj._init();
	world._registerObject(obj, proxy, ptr._base);

	return proxy;
    }

    static _fromPtr(world, arena, ptr) {
	let obj = new SharedObject(world, arena, ptr);
	let proxy = new Proxy(obj, handlers);
	world._registerObject(obj, proxy);

	// This thread now knows about this object, increase refcount
	// TODO: protect this with a lock once we have one
	ptr.set32(3, ptr.get32(3) + 1);
	return result;
    }
}

function create(arena) {
    let obj = new SharedObject(arena);
    let proxy = new Proxy(obj, handlers);
}

exports.SharedObject = SharedObject;
