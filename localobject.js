"use strict";

const util = require("util");
const debuglog = util.debuglog("localobject");

let arena = require("./arena.js");
let sync_internal = require("./sync_internal.js");

let OBJECT_TYPE_BITS = 4;
let MAX_OBJECT_TYPE = (1 << OBJECT_TYPE_BITS) - 1;

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

const ValueType = {
    UNDEFINED: 1,
    NULL: 2,
    BOOLEAN: 3,
    INTEGER: 4,
    OBJECT: 5,
    STRING: 6,
}

let PRIVATE = null;

let ENCODER = new TextEncoder();
let DECODER = new TextDecoder();

// Representation:
// - Value (specific to object type)
// - Object type | (id << OBJECT_TYPE_BITS)
// - Object lock
// - Reference count (both in object graph and from threads), lowest bit: GC mark

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

    _isInstance(obj, expectedType) {
	let priv = obj[PRIVATE];
	if (priv === undefined) {
	    // Not a LocalObject
	    return false;
	}

	if (priv._world !== this._world) {
	    // A different World, doesn't work
	    return false;
	}

	let actualType = LocalObject._getType(priv._ptr.get32(1));
	return expectedType === actualType;
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

    _freeValue(type, bytes) {
	if (type === ValueType.OBJECT) {
	    this._world._delWorldRef(this._arena.fromAddr(bytes));
	} else if (type === ValueType.STRING) {
	    if (bytes !== 0) {
		this._arena.free(this._arena.fromAddr(bytes));
	    }
	}
    }

    _cloneValue(type, bytes) {
	if (type === ValueType.OBJECT) {
	    this._world._addWorldRef(this._arena.fromAddr(bytes));
	    return [type, bytes];
	} else if (type === ValueType.STRING) {
	    if (bytes === 0) {
		return [type, bytes];
	    } else {
		let oldPtr = this._arena.fromAddr(bytes);
		let newPtr = this._arena.alloc(oldPtr.size());
		newPtr.asUint8().set(oldPtr.asUint8());
		return [type, newPtr._base];
	    }
	} else {
	    return [type, bytes];
	}
    }

    _valueFromBytes(type, bytes) {
	if (type === ValueType.UNDEFINED) {
	    return undefined;
	} else if (type === ValueType.NULL) {
	    return null;
	} else if (type === ValueType.BOOLEAN) {
	    return bytes !== 0;
	} else if (type === ValueType.INTEGER) {
	    // We could also use an Int32Array but this transformation must happen somewhere so meh.
	    // Performance is abysmal anyway.
	    return bytes < 2147483648 ? bytes : bytes - 4294967296;
	} else if (type == ValueType.OBJECT) {
	    return this._world._localFromAddr(bytes);
	} else if (type == ValueType.STRING) {
	    if (bytes === 0) {
		return "";
	    } else {
		let valuePtr = this._arena.fromAddr(bytes);
		return DECODER.decode(valuePtr.asUint8());
	    }
	} else {
	    throw new Error("not implemented");
	}
    }

    _valueToBytes(value) {
	let type = -1, bytes = -1;
	if (value === undefined) {
	    type = ValueType.UNDEFINED;
	    bytes = 0;
	} else if (value === null) {
	    type = ValueType.NULL;
	    bytes = 0;
	} else if (value === true) {
	    type = ValueType.BOOLEAN;
	    bytes = 1;
	} else if (value === false) {
	    type = ValueType.BOOLEAN;
	    bytes = 0;
	} else if (value[PRIVATE] !== undefined) {
	    // An object under our control (maybe in a different world!)
	    if (value[PRIVATE]._world !== this._world) {
		throw new Error("not supported");
	    }

	    type = ValueType.OBJECT;
	    bytes = value[PRIVATE]._ptr._base;
	    this._world._addWorldRef(value[PRIVATE]._ptr);
	} else if (typeof(value) === "number" && value >= INT32_MIN && value <= INT32_MAX) {
	    type = ValueType.INTEGER;
	    bytes = value;
	} else if (typeof(value) === "string") {
	    type = ValueType.STRING;

	    let stringBytes = ENCODER.encode(value);
	    if (value === "") {
		bytes = 0;
	    } else {
		let valuePtr = this._arena.alloc(stringBytes.length);
		valuePtr.asUint8().set(stringBytes);
		bytes = valuePtr._base;
	    }
	} else {
	    throw new Error("not implemented");
	}

	return [type, bytes];
    }

    *_valueReferences(type, bytes) {
	if (type === ValueType.OBJECT) {
	    yield bytes;
	}
    }

    _free() {
	// Overridden by subclasses. Frees all memory allocated by the object except the header.
    }

    *_references() {
	// Overridden by subclasses. Yields the addresses of objects directly referenced.
    }
}

function setPrivateSymbol(p) {
    PRIVATE = p;
}

// TODO: this is for use by World, should probably be a little more private
exports.setPrivateSymbol = setPrivateSymbol;
exports.LocalObject = LocalObject;
exports.MAX_OBJECT_TYPE = 0xf;
