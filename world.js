"use strict";

// TODO: Implement GC like this:
// 1. Objects are refcounted, on reaching zero, they are freed
// 2. On object alloc, its address is put on a livelist at the end of the heap, growing downwards,
//    then its ID (address from top of heap) is put in its header.
// 3. On object free, the free members of the livelist are maintained in a linked list. Its head
//    is in the world header, addresses are distinguished from free members by highest/lowest bit.
// 4. On object alloc, the freelist of the livelist is checked before allocating another member.
// 5. GC is stop-the-world, mark-and-sweep, reachability is marked either in a bit in object header
//    or in a high/low bit of the livelist.
// 6. If we want compaction, object pointers can contain an object ID instead at the cost of an
//    extra memory reference on access

const util = require("util");
const debuglog = util.debuglog("world");

let arena = require("./arena.js");
let dictionary = require("./dictionary.js");
let sync = require("./sync.js");

const PRIVATE = Symbol("World private data");

const HEADER_SIZE = 16;
const OBJECT_SIZE = 16;
const MAGIC = 0x1083041d;

const THREAD_RC_DELTA = 1000;    // Change in refcount for references from threads
const WORLD_RC_DELTA = 1;        // Change in refcount for references from within the world

const ObjectTypes = [
    null,  // marker so that zero is not a valid object type in RAM,
    dictionary.Dictionary,
    sync.Latch,
    sync.Lock
];

for (let i = 1; i < ObjectTypes.length; i++) {
    ObjectTypes[i]._registerForWorld(PRIVATE, i);
}

// World header:
// 0: magic (0x1083041d)
// 1: address of root object
// 2: object count (not including root object)
// 3: Lock

class World {
    constructor(a, header) {
	this._arena = a;
	this._header = header;
	this._addrToObject = new Map();
	this._registry = new FinalizationRegistry(priv => { this._dispose(priv); });
    }

    static create(size) {
	// We allocate:
	// - the size requested
	// - space for the world header
	// - space for the root objet
	// - memory block headers for the above two
	let a = arena.Arena.create(size + HEADER_SIZE + OBJECT_SIZE + 2 * arena.BLOCK_HEADER_SIZE);
	let header = a.alloc(HEADER_SIZE);
	if (header._base !== arena.ARENA_HEADER_SIZE) {
	    throw new Error("first block was not at the start of the arena");
	}

	let result = new World(a, header);
	result._root = result.createDictionary();

	header.set32(0, MAGIC);
	header.set32(1, result._root[PRIVATE]._ptr._base);
	header.set32(2, 0);

	return result;
    }

    static existing(sab) {
	let a = arena.Arena.existing(sab);
	let header = a.fromAddr(arena.ARENA_HEADER_SIZE);
	if (header.get32(0) !== MAGIC) {
	    throw new Error("invalid world magic" + header.get32(0));
	}

	let result = new World(a, header);
	result._root = result._localFromAddr(header.get32(1));

	return result;
    }

    root() {
	return this._root;
    }

    left() {
	return this._arena.left();
    }

    objectCount() {
	return this._header.get32(2);
    }

    buffer() {
	return this._arena.bytes;
    }

    createDictionary(...args) {
	return this._createObject(dictionary.Dictionary, ...args);
    }

    createLatch(...args) {
	return this._createObject(sync.Latch, ...args);
    }

    createLock(...args) {
	return this._createObject(sync.Lock, ...args);
    }

    _createObject(resultClass, ...args) {
	let ptr = this._arena.alloc(OBJECT_SIZE);
	debuglog("allocated " + resultClass.name + " @ " + ptr._base);

	let [priv, pub] = resultClass._create(this, this._arena, ptr);
	this._registerObject(priv, pub, ptr._base);

	// Initialize the object. This can allocate memory but should not create new objects because
	// that makes GC difficult:
	// - Either we link in the object to the global object chain before we call _init(). Then a
	//   GC from another thread will have to deal with an object whose memory is not initialized
	// - Or initialize the object before linking it to the global object chain. Then all objects
	//   created by _init() will be unreferenced (since they don't necessarily have a reference
	//   to them by the creating thread) and thus eligible for GC.
	// - We do something more clever (e.g. temporarily bump the refcount for these objects or
	//   lock the world with a reentrant lock). That's complicated and not necessary for now.
	priv._init(...args);

	// Only this thread knows about this object for now. This is enough to keep the newly
	// created object from being garbage collected. No one has a reference to the object yet so
	// no lock is needed.
	priv._ptr.set32(3, THREAD_RC_DELTA);

	// Register the object on the chain and thus make it eligible for GC. The world lock will be
	// needed for this.
	this._header.set32(2, this._header.get32(2) + 1);

	return pub;
    }

    _dispose(priv) {
	// TODO: protect this with a lock once we have one
	this._addrToObject.delete(priv._ptr._base);
	this._changeRefcount(priv._ptr, -THREAD_RC_DELTA, priv);
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
	    this._changeRefcount(ptr, THREAD_RC_DELTA);
	    this._registerObject(priv, pub, addr);
	}
	return pub;
    }

    _addWorldRef(objPtr) {
	// Refcount increases can't result in GC, so no optional priv= argument
	this._changeRefcount(objPtr, WORLD_RC_DELTA);
    }

    _delWorldRef(objPtr, priv=null) {
	this._changeRefcount(objPtr, -WORLD_RC_DELTA, priv);
    }

    // If the caller knows the private part of the object, it can pass it here so that it does
    // not need to be re-created on this thread or looked up in the map
    _changeRefcount(objPtr, delta, priv=null) {
	// TODO: acquire object lock
	// (and then make sure that the lock for another object is not held to avoid deadlocks)
	let oldRefcount = objPtr.get32(3);
	if (oldRefcount === 0) {
	    throw new Error("impossible");
	}

	let newRefcount = oldRefcount + delta;
	objPtr.set32(3, newRefcount);
	if (newRefcount !== 0) {
	    return;
	}

	if (priv === null) {
	    // We need to have a local object so that we can properly deallocate the data
	    // structures in the arena allocated by the world object
	    let pub = this._localFromAddr(objPtr._base, true);
	    priv = pub[PRIVATE];
	}

	this._header.set32(2, this._header.get32(2) - 1);
	priv._free();
    }
}

exports.World = World;
