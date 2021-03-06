"use strict";

const util = require("./util.js");
const debuglog = util.debuglog("array");

let sharedobject = require("./sharedobject.js");

// These are set when registering the object type for the world
let PRIVATE = null;
let BUFFER_TYPE = null;

function clamp(v, min, max) {
    if (v < min) {
	return min;
    } else if (v > max) {
	return max;
    } else {
	return v;
    }
}

// This class is only there so that we can pretend that this is the constructor of Array.
// If we wanted to do it properly, we'd need to close over the World instance used so that the
// constructor can in fact be used to create a new instance, but this is good enough to fool
// Jasmine.
class SharedArray {
}

function handlerApply(target, thisArg, args) {
    throw new Error("impossible");
}

function handlerConstruct(target, args, newTarget) {
    throw new Error("not supported");
}

function handlerGetPrototypeOf(target) {
    return SharedArray.prototype;
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
	return SharedArray;
    }

    return target._get(property);
}

function handlerSet(target, property, value, receiver) {
    return target._set(property, value);
}

function handlerDeleteProperty(target, property) {
    throw new Error("not implemented");
}

function handlerHas(target, property) {
    throw new Error("not implemented");
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

// Memory layout:
// 32 bits: size
// 32 bits: auxiliary array
// rest: storage (8 bytes for each value)
class Array extends sharedobject.SharedObject {
    constructor(world, arena, ptr) {
	super(world, arena, ptr);

	// Private methods
	this._nextValue = this._asAtomic(this._nextValueAtomic);
	this._cloneValues = this._asAtomic(this._cloneValuesAtomic);

	// Implementations of Array methods
	this._impl_push = this._asAtomic(this._pushAtomic);
	this._impl_pop = this._asAtomic(this._popAtomic);
	this._impl_shift = this._asAtomic(this._shiftAtomic);
	this._impl_unshift = this._asAtomic(this._unshiftAtomic);
	this._impl_splice = this._asAtomic(this._spliceAtomic);
	this._impl_at = this._asAtomic(this._atAtomic);
	this._getLength = this._asAtomic(this._getLengthAtomic);
	this._getOwnPropertyDescriptor = this._asAtomic(this._getOwnPropertyDescriptorAtomic);
    }

    static _registerForWorld(privateSymbol, bufferType) {
	PRIVATE = privateSymbol;
	BUFFER_TYPE = bufferType;
    }

    static _create(world, arena, ptr) {
	let obj = new Array(world, arena, ptr);
	let proxy = new Proxy(obj, handlers);

	return [obj, proxy];
    }


    _asAtomic(f) {
	return (...args) => {
	    return this._world._withMutation(() => {
		return this._criticalSection.run(() => {
		    return f.call(this, ...args);
		});
	    });
	};
    }

    _init() {
	super._init();
	this._setType(BUFFER_TYPE);

	// No storage initially
	this._ptr.set32(0, 0);
    }

    _reallocMaybe(needed) {
	let oldAddr = this._ptr.get32(0);
	let oldPtr;
	let newCapacity;
	let oldCapacity;

	if (oldAddr !== 0) {
	    oldPtr = this._arena.fromAddr(oldAddr);
	    oldCapacity = this._getCapacity(oldPtr);
	    newCapacity = oldCapacity;
	    while (newCapacity < needed) {
		newCapacity = Math.ceil(newCapacity * 1.25) + 2;
	    }
	}  else {
	    oldCapacity = 0;
	    newCapacity = needed;
	}

	if (newCapacity === oldCapacity) {
	    return oldPtr;
	}

	let newPtr = this._arena.alloc(newCapacity * 8 + 8);

	if (oldAddr !== 0) {
	    for (let i = 1; i < oldPtr.size() / 4; i++) {
		newPtr.set32(i, oldPtr.get32(i));
	    }
	    this._arena.free(oldPtr);
	} else {
	    // Initialize auxiliary dictionary ptr to "nothing"
	    newPtr.set32(1, 0);
	}

	let [type, bytes] = this._valueToBytes(undefined);
	for (let i = oldCapacity; i < newCapacity; i++) {
	    newPtr.set32(2 + 2 * i, type);
	    newPtr.set32(3 + 2 * i, bytes);
	}

	this._ptr.set32(0, newPtr._base);
	debuglog("reallocated to capacity " + newCapacity + " @ " + newPtr._base);
	return newPtr;
    }

    _free() {
	let storePtr = this._getStore();
	if (storePtr !== null) {
	    for (let i = 0; i < this._getSize(storePtr); i++) {
		let type = storePtr.get32(2 + 2 * i);
		let bytes = storePtr.get32(3 + 2 * i);

		this._freeValue(type, bytes);
	    }

	    this._arena.free(storePtr);
	    debuglog("freed backing store @ " + storePtr._base);
	}
	super._free();
    }

    *_references() {
        let storePtr = this._getStore();
        if (storePtr === null) {
            return;
        }

        for (let i = 0; i < this._getSize(storePtr); i++) {
            let type = storePtr.get32(2 + 2 * i);
            let bytes = storePtr.get32(3 + 2 * i);
            yield* this._valueReferences(type, bytes);
        }
    }

    _getStore() {
	let addr = this._ptr.get32(0);
	if (addr === 0) {
	    return null;
	} else {
	    return this._arena.fromAddr(addr);
	}
    }

    _getCapacity(storePtr) {
	return (storePtr.size() - 8) / 8;
    }

    _getSize(storePtr) {
	return storePtr.get32(0);
    }

    _atAtomic(i) {
	let idx;
	if (typeof(i) === "number") {
	    idx = i;
	} else {
	    idx = parseInt(i);
	}

	if (isNaN(idx) || idx < 0) {
	    return undefined;  // Apparently that's what happens for weird indices
	}

	let storePtr = this._getStore();
	if (storePtr === null) {
	    return undefined;  // Spec says so
	}

	if (idx >= this._getSize(storePtr)) {
	    return undefined;
	}

	let type = storePtr.get32(2 + 2 * idx);
	let bytes = storePtr.get32(3 + 2 * idx);

	return this._valueFromBytes(type, bytes);
    }

    _pushAtomic(...args) {
	let values = this._toValues(...args);

	let oldSize;

	let storePtr = this._getStore();
	if (storePtr === null) {
	    oldSize = 0;
	} else {
	    oldSize = this._getSize(storePtr);
	}

	let newSize = oldSize + args.length;
	storePtr = this._reallocMaybe(newSize);

	for (let i = 0; i < args.length; i++) {
	    let [type, bytes] = values[i];
	    storePtr.set32(2 + 2 * (oldSize + i), type);
	    storePtr.set32(3 + 2 * (oldSize + i), bytes);
	}

	storePtr.set32(0, newSize);
    }

    _popAtomic() {
	let storePtr = this._getStore();
	if (storePtr === null) {
	    return undefined;
	}

	let oldSize = this._getSize(storePtr);
	if (oldSize === 0) {
	    return undefined;
	}

	let newSize = oldSize - 1;
	let type = storePtr.get32(2 + newSize * 2);
	let bytes = storePtr.get32(3 + newSize * 2);
	let result = this._valueFromBytes(type, bytes);

	this._freeValue(type, bytes);
	[type, bytes] = this._valueToBytes(undefined);
	storePtr.set32(2 + newSize * 2, type);
	storePtr.set32(3 + newSize * 2, bytes);
	storePtr.set32(0, newSize);

	return result;
    }

    _unshiftAtomic(...args) {
	let values = this._toValues(...args);

	let oldSize;
	let storePtr = this._getStore();
	if (storePtr === null) {
	    oldSize = 0;
	} else {
	    oldSize = this._getSize(storePtr);
	}

	// TODO: this potentially moves memory *twice* which could be avoided by a tiny bit more
	// complicated reallocation logic, but I am optimizing for development time here
	let newSize = oldSize + args.length;
	storePtr = this._reallocMaybe(newSize);

	for (let i = oldSize * 2 - 1; i >= 0; i--) {
	    storePtr.set32(args.length * 2 + 2 + i, storePtr.get32(2 + i));
	}

	for (let i = 0; i < args.length; i++) {
	    let [type, bytes] = values[i];
	    storePtr.set32(2 + i * 2, type);
	    storePtr.set32(3 + i * 2, bytes);
	}

	storePtr.set32(0, newSize);
    }

    _shiftAtomic() {
	let storePtr = this._getStore();
	if (storePtr === null) {
	    return undefined;
	}

	let oldSize = this._getSize(storePtr);
	if (oldSize === 0) {
	    return undefined;
	}

	let type = storePtr.get32(2);
	let bytes = storePtr.get32(3);
	let newSize = oldSize - 1;
	let result = this._valueFromBytes(type, bytes);

	for (let i = 0; i < newSize * 2; i++) {
	    storePtr.set32(2 + i, storePtr.get32(4 + i));
	}

	this._freeValue(type, bytes);
	[type, bytes] = this._valueToBytes(undefined);
	storePtr.set32(2 + newSize * 2, type);
	storePtr.set32(3 + newSize * 2, bytes);
	storePtr.set32(0, newSize);

	return result;

    }

    _cloneValuesAtomic(start, end) {
	let result = [];
	let storePtr = this._getStore();
	if (storePtr === null) {
	    return result;
	}

	let size = this._getSize(storePtr);
	if (start === undefined) {
	    start = 0;
	} else if (start < 0) {
	    start = size + start;
	}

	if (end === undefined) {
	    end = size;
	} else if (end < 0) {
	    end = size + end;
	}

	start = clamp(start, 0, size);
	end = clamp(end, 0, size);

	for (let i = start; i < end; i++) {
	    result.push(this._cloneValue(storePtr.get32(2 + i * 2), storePtr.get32(3 + i * 2)));
	}

	return result;
    }

    _createNewArray(values) {
	let pub = this._world.createArray();
	let priv = pub[PRIVATE];

	if (values.length === 0) {
	    return pub;
	}

	let privStore = priv._reallocMaybe(values.length);
	privStore.set32(0, values.length);
	privStore.set32(1, 0);  // Auxiliary dict, currently not implemented
	for (let i = 0; i < values.length; i++) {
	    privStore.set32(2 + i * 2, values[i][0]);
	    privStore.set32(3 + i * 2, values[i][1]);
	}

	return pub;
    }

    // This method containts multiple _withMutation() calls, but this time, it is fine because no
    // reference is deleted while it's running and every accessed value is already referenced from
    // somewhere so GC can't free an object from under us.
    _impl_concat(...args) {
	let outputSize = 0;
	let values = [];
	let ok = false;

	try {
	    values.push(...this._cloneValues());
	    for (let arg of args) {
		if (this._isInstance(arg, BUFFER_TYPE)) {
		    // This is another array. Add a reference to every value in it.
		    values.push(...arg[PRIVATE]._cloneValues());
		} else {
		    // This is a regular value. Move it into our address space as usual.
		    this._world._withMutation(() => {
			values.push(this._valueToBytes(arg));
		    });
		}
	    }

	    ok = true;
	    return this._createNewArray(values);
	} finally {
	    if (!ok) {
		// Something went wrong. Free all memory we have allocated so far
		// (Once we have cloned every reference things can't go wrong anymore, expect for
		// OOM on _reallocMaybe(), but we officially don't care about ending up in a valid
		// state after OOM)
		this._world._withMutation(() => {
		    for (let [type, bytes] of values) {
			this._freeValue(type, bytes);
		    }
		});
	    }
	}
    }

    _impl_slice(start, end) {
	let values = this._cloneValues(start, end);
	return this._createNewArray(values);
    }

    _logContents(storePtr) {
	let contents = "[ ";
	console.log("size: " + storePtr.get32(0));
	for (let i = 0; i < 2 + 2 * storePtr.get32(0); i++) {
	    contents += storePtr.get32(i) + ", ";
	}

	contents += "]";
	console.log("CONTENTS: " + contents);
    }

    _toValues(...items) {
	let result = [];
	let ok = false;

	try {
	    for (let item of items) {
		result.push(this._valueToBytes(item));
	    }
	    ok = true;
	} finally {
	    if (!ok) {
		for (let [type, bytes] of result) {
		    this._freeValue(type, bytes);
		}
	    }
	}

	return result;
    }

    _spliceAtomic(start, deleteCount, ...items) {
	let itemValues = this._toValues(...items);

	// This can signal an OOM but we don't care much about refcounts after an OOM, at least for
	// the time being

	let storePtr = this._getStore();
	let size = storePtr === null ? 0 : storePtr.get32(0);
	deleteCount = clamp(deleteCount, 0, size - start);
	let delta = itemValues.length - deleteCount;
	let newSize = size + delta;
	storePtr = this._reallocMaybe(newSize);

	// Save values that are deleted.
	let removedValues = [];
	for (let i = start; i < start + deleteCount; i++) {
	    removedValues.push([storePtr.get32(2 + 2 * i), storePtr.get32(3 + 2 * i)]);
	}

	// Move the part of the array after the discarded values to its right place
	let buf = storePtr.asUint8();
	buf.copyWithin(
	    8 + (start + itemValues.length) * 8,  // target
	    8 + (start + deleteCount) * 8,    // start
	    8 + size * 8);                    // end

	// Splice in the new values
	for (let i = 0; i < itemValues.length; i++) {
	    storePtr.set32(2 + 2 * (start + i), itemValues[i][0]);
	    storePtr.set32(3 + 2 * (start + i), itemValues[i][1]);
	}

	storePtr.set32(0, newSize);
	return this._createNewArray(removedValues);
    }

    _nextValueAtomic(i) {
	if (i >= this._getLengthAtomic()) {
	    return { value: undefined, done: true };
	} else {
	    return { value: this._atAtomic(i), done: false };
	}
    }

    *_impl_values() {
	let i = 0;
	while (true) {
	    let n = this._nextValue(i);
	    if (n.done) {
		break;
	    }

	    yield n.value;
	    i += 1;
	}
    }

    _get(property) {
	if (property === PRIVATE) {
	    // This is for internal use (PRIVATE is hidden from everyone else)
	    return this;
	}

	if (typeof(property) !== "string") {
	    // Not even the non-existent auxiliary Dictionary supports Symbols
	    return undefined;
	}

	let idx = parseInt(property);
	if (!isNaN(idx)) {
	    // We have successfully converted an integer to string and back again, but let's at
	    // least conform to the spec, if hilariously slowly
	    return this._impl_at(idx);
	}

	if (property === "length") {
	    return this._getLength();
	}

	let implName = "_impl_" + property;
	if (implName in this) {
	    return this[implName].bind(this);
	}

	return undefined;
    }

    _getLengthAtomic() {
	let storePtr = this._getStore();
	if (storePtr === null) {
	    return 0;
	} else {
	    return this._getSize(storePtr);
	}
    }

    _getNonIndexAtomic(property) {
    }

    _set(property, value) {
	let idx = parseInt(property);
	if (isNaN(idx) || idx < 0) {
	    // TODO: according to spec, we should be able to set arbitrary keys even though it requires
	    // an auxiliary Dictionary instance.
	    throw new Error("not implemented");
	}

	// Set numeric index

	let newType, newValue;

	this._world._withMutation(() => {
	    [newType, newValue] = this._valueToBytes(value);
	    this._criticalSection.run(() => {
		let storePtr = this._reallocMaybe(idx + 1);

		let oldType = storePtr.get32(2 + 2 * idx);
		let oldValue = storePtr.get32(3 + 2 * idx);
		this._freeValue(oldType, oldValue);

		storePtr.set32(2 + 2 * idx, newType);
		storePtr.set32(3 + 2 * idx, newValue);

		let oldSize = storePtr.get32(0);
		if (oldSize < idx + 1) {
		    storePtr.set32(0, idx + 1);
		}
	    });
	});

	return true;
    }

    // This implementation is kinda stupid, but spec says that the result must be an Array, so
    // a generator function does not work (I tried)
    _ownKeys() {
	let length = this._getLength();
	let result = [];
	for (let i = 0; i < length; i++) {
	    result.push(i.toString());
	}

	return result;
    }

    _getOwnPropertyDescriptorAtomic(property) {
	if (typeof(property) !== "string") {
	    return undefined;
	}

	let length = this._getLengthAtomic();
	let idx = Number.parseInt(property);
	if (Number.isNaN(idx)) {
	    return undefined;
	}

	// Exclude cases like "00" and "01" (not very logical, but hallowed be the spec)
	if (idx.toString() !== property) {
	    return undefined;
	}

	return {
	    value: this._atAtomic(idx),
	    writable: true,
	    enumerable: true,
	    configurable: true
	};
    }
}

exports.Array = Array;
