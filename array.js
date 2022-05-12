"use strict";

const util = require("util");
const debuglog = util.debuglog("array");

let localobject = require("./localobject.js");

// These are set when registering the object type for the world
let PRIVATE = null;
let BUFFER_TYPE = null;

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
    throw new Error("not implemented");
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

class Array extends localobject.LocalObject {
    constructor(world, arena, ptr) {
	super(world, arena, ptr);
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

    _init() {
	super._init();
	this._setType(BUFFER_TYPE);
    }

    _free() {
	super._free();
    }

    _impl_at(i) {
	throw new Error("at() not implemented");
    }

    _impl_push(...args) {
	throw new Error("push() not implemented");
    }

    _impl_pop() {
	throw new Error("pop() not implemented");
    }

    _impl_unshift() {
	throw new Error("unshift() not implemented");
    }

    _impl_shift() {
	throw new Error("shift() not implemented");
    }

    _impl_concat() {
	throw new Error("concat() not implemented");
    }

    _impl_slice() {
	throw new Error("slice() not implemented");
    }

    _impl_splice() {
	throw new Error("splice() not implemented");
    }

    _impl_values() {
	throw new Error("values() not implemented");
    }

    _get(property) {
	let idx = parseInt(property);
	if (!isNaN(idx)) {
	    // We have successfully converted an integer to string and back again, but let's at
	    // least conform to the spec, if hilariously slowly
	    console.log(idx);
	    return this._impl_at(idx);
	}

	if (idx === "length") {
	    throw new Error("length not implemented");
	}

	let implName = "_impl_" + property;
	if (implName in this) {
	    return this[implName].bind(this);
	}

	return undefined;
    }

    _set(property, value) {
	let idx = parseInt(property);
	if (idx !== NaN) {
	    // Set numeric index.
	}

	// TODO: according to spec, we should be able to set arbitrary keys even though it requires
	// an auxiliary Dictionary instance.
	throw new Error("not implemented");
    }
}

exports.Array = Array;
