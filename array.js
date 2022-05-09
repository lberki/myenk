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
    return target._deleteProperty(property);
}

function handlerHas(target, property) {
    return target._has(property);
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
}

exports.Array = Array;
