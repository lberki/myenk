"use strict";

// FORMAT:
// - generation counter (int32 is plenty, I guess?)
// - linked list of (ptr to property name, ptr to property value)
// - each property is a separate biock (or maybe two for name / value)
// - Cache (Map or just object) of property addresses, invalidated on generation change

// TODO:
// - Implement proxy (backed by JS object for the time being)
// - Implement data storage as above
// - Implement primitive data types (bigint + float can come later, I don't hate myself)
// - Implement symbols as keys
// - Implement a weak map (WeakMap or WeakRef + FinalizationRegistry) for deallocation

// KNOWLEDGE BASE:
// - TextEncoder for UTF-8
// - Float64Array for FP
// - Bigint manually
// - Symbol-to-sequence id bimap for Symbols
// - --expose-gc exposes global.gc() for debugging

const util = require("util");
const debuglog = util.debuglog("object");

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
    throw new Error("unsupported");
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
    throw new Error("not implemented");
}

function handlerSet(target, property, value, receiver) {
    throw new Error("not implemented");
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

const Private = Symbol("SharedObject internals");

class SharedObject {
    constructor(arena) {
	this[Private] = {
	    _arena: arena
	};
    }
}

function create(arena) {
    let obj = new SharedObject(arena);
    let proxy = new Proxy(obj, handlers);
}

exports.SharedObject = SharedObject;
