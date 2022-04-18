"use strict";

let arena = require("./arena.js");
let object = require("./object.js");

class World {
    constructor(size) {
	this.arena = new arena.Arena(size);
	this.addrToProxy = new Map();
	this.registry = new FinalizationRegistry(obj => { obj._dispose(); });
    }

    create() {
	return object.SharedObject._createNew(this, this.arena);
    }

    _deregisterObject(addr) {
	this.addrToProxy.delete(addr);
    }

    _registerObject(obj, proxy, addr) {
	let wr = new WeakRef(proxy);
	this.registry.register(proxy, obj);
	this.addrToProxy.set(addr, wr);
    }

    _proxyFromAddr(addr) {
	let wr = this.addrToProxy.get(addr);
	if (wr !== undefined) {
	    // Do not call deref() twice in case GC happens in between
	    let existing = wr.deref();
	    if (existing !== undefined) {
		return existing;
	    }
	}

	let ptr = this.arena.fromAddr(addr);
	proxy = object.SharedObject._fromPtr(ptr);
	return proxy;
    }
}

exports.World = World;
