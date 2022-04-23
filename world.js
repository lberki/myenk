"use strict";

let arena = require("./arena.js");

const PRIVATE = Symbol("Nostrum Private");

// Representation:
// - Value (specific to object type)
// - Object type
// - <reserved for object lock>
// - Reference count (both in object graph and from threads)

class LocalObject {
    constructor(world, arena, ptr) {
	this._world = world;
	this._arena = arena;
	this._ptr = ptr;
    }

    _init() {
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

    _free() {
	this._arena.free(this._ptr);
    }
}

class World {
    constructor(size) {
	this.arena = arena.Arena.create(size);
	this.addrToObject = new Map();
	this.registry = new FinalizationRegistry(priv => { priv._dispose(); });
    }

    static _objectTypes = [];

    static registerObjectType(type) {
	let index = World._objectTypes.length;
	World._objectTypes.push(type);
    }

    create(resultClass, ...args) {
	let ptr = this.arena.alloc(16);
	let [priv, pub] = resultClass._create(this, this.arena, ptr);
	priv._init(...args);
	this._registerObject(priv, pub, ptr._base);
	return pub;
    }

    _deregisterObject(addr) {
	this.addrToObject.delete(addr);
    }

    _registerObject(priv, pub, addr) {
	let wr = new WeakRef(pub);
	this.registry.register(pub, priv);
	this.addrToObject.set(addr, wr);
    }

    _localFromAddr(addr, forGc=false) {
	let wr = this.addrToObject.get(addr);
	if (wr !== undefined) {
	    // Do not call deref() twice in case GC happens in between
	    let existing = wr.deref();
	    if (existing !== undefined) {
		return existing;
	    }
	}

	let ptr = this.arena.fromAddr(addr);
	let type = ptr.get32(1);
	if (type < 0 || type >= World._objectTypes.length) {
	    throw new Error("invalid object type in shared buffer: " + type);
	}

	let [priv, pub] = World._objectTypes[type]._create(this, this.arena, ptr);
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
exports.LocalObject = LocalObject;
exports.PRIVATE = PRIVATE;
