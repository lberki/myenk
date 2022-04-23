"use strict";

const util = require("util");
const debuglog = util.debuglog("world");

let arena = require("./arena.js");
let dictionary = require("./dictionary.js");
let sync = require("./sync.js");

const PRIVATE = Symbol("World private data");

const HEADER_SIZE = 16;
const OBJECT_SIZE = 16;

const ObjectTypes = [
    null,  // marker so that zero is not a valid object type in RAM,
    dictionary.Dictionary,
    sync.Latch
];

for (let i = 1; i < ObjectTypes.length; i++) {
    ObjectTypes[i]._registerForWorld(PRIVATE, i);
}

class World {
    constructor(a) {
	this._arena = a;
	this._addrToObject = new Map();
	this._registry = new FinalizationRegistry(priv => { priv._dispose(); });
    }

    static _objectTypes = [];

    static create(size) {
	let a = arena.Arena.create(size + HEADER_SIZE + OBJECT_SIZE + 2 * arena.BLOCK_HEADER_SIZE);
	let header = a.alloc(HEADER_SIZE);
	let result = new World(a);
	result._root = result.createDictionary();
	return result;
    }

    root() {
	return this._root;
    }

    left() {
	return this._arena.left();
    }

    createDictionary(...args) {
	return this._createObject(dictionary.Dictionary, ...args);
    }

    createLatch(...args) {
	return this._createObject(sync.Latch, ...args);
    }

    _createObject(resultClass, ...args) {
	let ptr = this._arena.alloc(OBJECT_SIZE);
	debuglog("allocated " + resultClass.name + " @ " + ptr._base);
	let [priv, pub] = resultClass._create(this, this._arena, ptr);
	priv._init(...args);
	this._registerObject(priv, pub, ptr._base);
	return pub;
    }

    _deregisterObject(addr) {
	this._addrToObject.delete(addr);
    }

    _registerObject(priv, pub, addr) {
	let wr = new WeakRef(pub);
	this._registry.register(pub, priv);
	this._addrToObject.set(addr, wr);
    }

    _localFromAddr(addr, forGc=false) {
	let wr = this._addrToObject.get(addr);
	if (wr !== undefined) {
	    // Do not call deref() twice in case GC happens in between
	    let existing = wr.deref();
	    if (existing !== undefined) {
		return existing;
	    }
	}

	let ptr = this._arena.fromAddr(addr);
	let type = ptr.get32(1);
	if (type <= 0 || type >= ObjectTypes.length) {
	    throw new Error("invalid object type in shared buffer: " + type);
	}

	let [priv, pub] = ObjectTypes[type]._create(this, this._arena, ptr);
	if (!forGc) {
	    this._world._changeRefcount(result._ptr, 1);
	    this._registerObject(priv, pub, addr);
	}
	return pub;
    }

    _changeRefcount(objPtr, delta) {
	// TODO: acquire object lock
	// (and then make sure that the lock for another object is not held to avoid deadlocks)
	let oldRefcount = objPtr.get32(3);
	if (oldRefcount === 0) {
	    throw new Error("impossible");
	}

	let newRefcount = oldRefcount + delta;
	objPtr.set32(3, newRefcount);
	if (newRefcount === 0) {
	    let pub = this._localFromAddr(objPtr._base, true);
	    pub[PRIVATE]._free();
	}
    }
}

exports.World = World;
