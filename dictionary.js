"use strict";

// TODO:
// - Add local objects to consistency checks:
//    - localToPrivate objects are the same as on object ID chain
//    - addrToPublic keys are all on object ID chain
// - Add a test case for freeing (and keeping alive) objects from worker threads
// - Add a test case for the "access from other threads raises exception" functionality
// - Figure out a way to re-enable the "refcount cannot be 0" assertion
// - Write documentation about emptyDumpster() (or make the method unnecessary)

// - Implement various methods on Dictionary
// - Implement symbol values
// - Shorten symbols:
//   - world.World.create -> world.create()
//   - createArray() -> array (and the like)
// - Implement auxiliary dictionary for Array (make sure not to double lock)

// - Figure out why the latch test case is slow (150ms per iteration!)
// - Implement symbols as dictionary keys and values

// KNOWLEDGE BASE:
// - Float64Array for FP
// - Bigint manually
// - Symbol-to-sequence id bimap for Symbols

const util = require("util");
const debuglog = util.debuglog("dictionary");

let sharedobject = require("./sharedobject.js");

// These are set when registering the object type for the world
let PRIVATE = null;
let BUFFER_TYPE = null;

let ENCODER = new TextEncoder();
let DECODER = new TextDecoder();

// This class is only there so that we can pretend that this is the constructor of Dictionary.
// If we wanted to do it properly, we'd need to close over the World instance used so that the
// constructor can in fact be used to create a new instance, but this is good enough to fool
// Jasmine.
class SharedDictionary {
}

function handlerApply(target, thisArg, args) {
    throw new Error("impossible");
}

function handlerConstruct(target, args, newTarget) {
    throw new Error("not supported");
}

function handlerGetPrototypeOf(target) {
    return SharedDictionary.prototype;
}

function handlerSetPrototypeOf(target, prototype) {
    throw new Error("not supported");
}

function handlerDefineProperty(target, key, descriptor) {
    throw new Error("not implemented");
}

function handlerGetOwnPropertyDescriptor(target, property) {
    return target._getOwnPropertyDescriptor(property);
}

function handlerIsExtensible(target) {
    throw new Error("not implemented");
}

function handlerPreventExtensions(target) {
    throw new Error("not implemented");
}

function handlerGet(target, property, receiver) {
    if (property === "constructor") {
	return SharedDictionary;
    }

    return target._get(property);
}

function handlerSet(target, property, value, receiver) {
    return target._set(property, value);
}

function handlerDeleteProperty(target, property) {
    return target._deleteProperty(property);
}

function handlerHas(target, property) {
    return target._has(property);
}

function handlerOwnKeys(target) {
    return target._ownKeys();
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
class Dictionary extends sharedobject.SharedObject {
    constructor(world, arena, ptr) {
	super(world, arena, ptr);
    }

    static _registerForWorld(privateSymbol, bufferType) {
	PRIVATE = privateSymbol;
	BUFFER_TYPE = bufferType;
    }

    _init() {
	super._init();

	this._setType(BUFFER_TYPE);

	// No fields at the beginning
	this._ptr.set32(0, 0);
    }

    _freeCell(cellPtr) {
	this._freeValue(cellPtr.get32(2), cellPtr.get32(3));

	this._arena.free(this._arena.fromAddr(cellPtr.get32(1)));  // Free key
	this._arena.free(cellPtr);  // Free cell
    }

    _free() {
	// Walk the property linked list and free each cell and its contents
	let cell = this._ptr.get32(0);
	while (cell !== 0) {
	    let cellPtr = this._arena.fromAddr(cell);
	    cell = cellPtr.get32(0);
	    this._freeCell(cellPtr);
	}

	super._free();
    }

    *_references() {
	let cell = this._ptr.get32(0);
	while (cell !== 0) {
	    let cellPtr = this._arena.fromAddr(cell);
	    yield* this._valueReferences(cellPtr.get32(2), cellPtr.get32(3));
	    cell = cellPtr.get32(0);
	}
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

	    if (keyPtr.size() !== bytes.length) {
		ok = false;
	    } else {
		for (let i = 0; i < bytes.length; i++) {
		    if (keyPtr.get8(i) !== bytes[i]) {
			ok = false;
			break;
		    }
		}
	    }

	    if (ok) {
		return [prevPtr, nextPtr];
	    }

	    prevPtr = nextPtr;
	}

	return [null, null];
    }

    _get(property) {
	if (property === PRIVATE) {
	    // This is for internal use (PRIVATE is hidden from everyone else)
	    return this;
	}

	return this._world._withMutation(() => {
	    return this._criticalSection.run(() => {
		return this._getInMutation(property);
	    });
	});
    }

    _getInMutation(property) {
	if (typeof(property) !== "string") {
	    // The setter throws an exception so this conforms to spec
	    return undefined;
	}

	let propBytes = ENCODER.encode(property);
	let [_, cellPtr] = this._findProperty(propBytes);
	if (cellPtr === null) {
	    return undefined;
	}

	return this._valueFromBytes(cellPtr.get32(2), cellPtr.get32(3));
    }

    _set(property, value) {
	return this._world._withMutation(() => {
	    let [bufferType, bufferValue] = this._valueToBytes(value);

	    return this._criticalSection.run(() => {
		return this._setInMutation(property, bufferType, bufferValue);
	    });
	});
    }

    _setInMutation(property, bufferType, bufferValue) {
	if (typeof(property) !== "string") {
	    throw new Error("not implemented");
	}

	let propBytes = ENCODER.encode(property);
	let [_, cellPtr] = this._findProperty(propBytes);
	if (cellPtr === null) {
	    // The property does not exist, allocate it
	    let keyPtr = this._arena.alloc(propBytes.length);
	    keyPtr.asUint8().set(propBytes);
	    cellPtr = this._arena.alloc(16);
	    cellPtr.set32(1, keyPtr._base);

	    // Link in the new cell
	    cellPtr.set32(0, this._ptr.get32(0));
	    this._ptr.set32(0, cellPtr._base);
	} else {
	    this._freeValue(cellPtr.get32(2), cellPtr.get32(3));
	}

	cellPtr.set32(2, bufferType);
	cellPtr.set32(3, bufferValue);

	return true;
    }

    _deleteProperty(property) {
	return this._world._withMutation(() => {
	    return this._criticalSection.run(() => {
		return this._deletePropertyInMutation(property);
	    });
	});
    }

    _deletePropertyInMutation(property) {
	let propBytes = ENCODER.encode(property);
	let [prevPtr, nextPtr] = this._findProperty(propBytes);

	if (prevPtr === null) {
	    return true;
	}

	// Unlink the cell and free it
	prevPtr.set32(0, nextPtr.get32(0));
	this._freeCell(nextPtr);
	return true;
    }

    _has(property) {
	let propBytes = ENCODER.encode(property);

	return this._criticalSection.run(() => {
	    let [_, cellPtr] = this._findProperty(propBytes);
	    return cellPtr !== null;
	});
    }

    _getOwnPropertyDescriptor(property) {
	return this._world._withMutation(() => {
	    return this._criticalSection.run(() => {
		return this._getOwnPropertyDescriptorInMutation(property);
	    });
	});
    }

    _getOwnPropertyDescriptorInMutation(property) {
	if (typeof(property) !== "string") {
	    // The setter throws an exception so this conforms to spec
	    return undefined;
	}

	let propBytes = ENCODER.encode(property);
	let [_, cellPtr] = this._findProperty(propBytes);
	if (cellPtr === null) {
	    return undefined;
	}

	let value = this._valueFromBytes(cellPtr.get32(2), cellPtr.get32(3));
	return {
	    value: value,
	    writable: true,
	    enumerable: true,
	    configurable: true
	};
    }

    _ownKeys(property) {
	let keys = [];

	// It would be nice to have an iterator instead, but in that case, we'd either have to hold
	// the object lock while the iterator is active (not a great idea) or do something really
	// clever (and clever is trouble), so dumb algorithm it is.
	this._criticalSection.run(() => {
	    let cell = this._ptr.get32(0);
	    while (cell !== 0) {
		let cellPtr = this._arena.fromAddr(cell);
		let keyPtr = this._arena.fromAddr(cellPtr.get32(1));
		let key = DECODER.decode(keyPtr.asUint8());
		keys.push(key);
		cell = cellPtr.get32(0);
	    }
	});

	return keys;
    }

    static _create(world, arena, ptr) {
	let obj = new Dictionary(world, arena, ptr);
	let proxy = new Proxy(obj, handlers);

	return [obj, proxy];
    }
}

exports.Dictionary = Dictionary;
