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
let localobject = require("./localobject.js");
let dictionary = require("./dictionary.js");
let sync = require("./sync.js");
let sync_internal = require("./sync_internal.js");


const PRIVATE = Symbol("World private data");

const HEADER_SIZE = 32;
const OBJECT_SIZE = 16;
const MAGIC = 0x1083041d;
const EXTENDED_SANITY_CHECKS = true;

const THREAD_RC_DELTA = 1000;    // Change in refcount for references from threads
const WORLD_RC_DELTA = 1;        // Change in refcount for references from within the world

const OBJLIST_INCREMENT = 4;     // Small enough to get triggered in test cases

const ObjectTypes = [
    null,  // marker so that zero is not a valid object type in RAM,
    dictionary.Dictionary,
    sync.Latch,
    sync.Lock
];

for (let i = 1; i < ObjectTypes.length; i++) {
    ObjectTypes[i]._registerForWorld(PRIVATE, i);
}

const HEADER = {
    "MAGIC": 0,
    "ROOT": 1,  // Address of root object
    "OBJECT_COUNT": 2,  // including root object
    "LOCK": 3,
    "OBJLIST": 4,  // Address of object list block
    "OBJLIST_SIZE": 5,  // Number of used object IDs (=high water mark)
    "OBJLIST_CAPACITY": 6,  // Allocated length of objlist
    "FREELIST": 7,  // head of object ID freelist within object list block
};

class World {
    constructor(a, header) {
	this._arena = a;
	this._header = header;
	this._addrToObject = new Map();
	this._registry = new FinalizationRegistry(priv => { this._dispose(priv); });
	this._mutation = null;
	this._criticalSection = new sync_internal.CriticalSection(
	    this._arena.int32,
	    (header._base + arena.BLOCK_HEADER_SIZE) / 4 + 3);
	this.sanityCheck = this._criticalSection.wrap(this, this._sanityCheckLocked);
    }

    static create(size) {
	// We allocate:
	// - the size requested
	// - space for the world header
	// - space for the root object
	// - memory block headers for the above two
	let a = arena.Arena.create(size + HEADER_SIZE + OBJECT_SIZE + 2 * arena.BLOCK_HEADER_SIZE);
	let header = a.alloc(HEADER_SIZE);
	if (header._base !== arena.ARENA_HEADER_SIZE) {
	    throw new Error("first block was not at the start of the arena");
	}

	let result = new World(a, header);

	header.set32(HEADER.MAGIC, MAGIC);  // Magic
	header.set32(HEADER.OBJECT_COUNT, 0);
	header.set32(HEADER.LOCK, 0);
	header.set32(HEADER.OBJLIST, 0);
	header.set32(HEADER.OBJLIST_SIZE, 0);
	header.set32(HEADER.OBJLIST_CAPACITY, 0);
	header.set32(HEADER.FREELIST, 0);

	result._root = result.createDictionary();
	header.set32(HEADER.ROOT, result._root[PRIVATE]._ptr._base);  // Root object

	return result;
    }

    static existing(sab) {
	let a = arena.Arena.existing(sab);
	let header = a.fromAddr(arena.ARENA_HEADER_SIZE);
	if (header.get32(HEADER.MAGIC) !== MAGIC) {
	    throw new Error("invalid world magic" + header.get32(HEADER.MAGIC));
	}

	let result = new World(a, header);
	result._withMutation(() => {
	    result._root = result._localFromAddr(header.get32(HEADER.ROOT));
	});

	return result;
    }

    root() {
	return this._root;
    }

    left() {
	return this._arena.left();
    }

    objectCount() {
	return this._header.get32(HEADER.OBJECT_COUNT) - 1;
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

    // Run a mutation of the object graph.
    //
    // This needs to be done like this because we don't want to try to lock an object to change its
    // refcount while we are mutating another one, so we record refcount changes during the mutation
    // and apply the after it is done. A refcount decrement can result in freeing objects which can
    // itself result in decrementing a refcount and so on, so it needs to be done a in a loop until
    // a steady state is reached.
    _withMutation(l) {
	if (this._mutation !== null) {
	    throw new Error("impossible");
	}

	this._mutation = [];
	try {
	    return l();
	} finally {
	    let objectsFreed = 0;
	    let idsToFree = [];

	    while (this._mutation.length > 0) {
		this._toFree = [];

		// First commit refcount changes
		for (let m of this._mutation) {
		    this._commitRefcount(m.objPtr, m.delta, m.priv);
		}

		// ...then free objects that need to be freed and record the mutations caused by
		// that in turn
		this._mutation = [];
		for (let priv of this._toFree) {
		    // Free object. May cause new refcount changes.
		    // TODO: It is currently guaranteed that we are the only thread accessing this
		    // object, but once GC is implemented, GC might catch it on another thread and
		    // then that must be protected against.
		    objectsFreed += 1;
		    debuglog("freeing object ID " + priv._getId() + " with object @ " + priv._ptr._base);
		    idsToFree.push(priv._getId());
		    priv._free();
		}

		// ...and continue recording the mutations caused by freeing objects, if needed.
	    }

	    this._criticalSection.run(() => {
		// Decrease object count
		this._header.set32(
		    HEADER.OBJECT_COUNT,
		    this._header.get32(HEADER.OBJECT_COUNT) - objectsFreed);

		for (let id of idsToFree) {
		    this._objectIdToFreelist(id);
		}

		if (EXTENDED_SANITY_CHECKS) {
		    this._sanityCheckLocked();
		}
	    });

	    this._toFree = null;
	    this._mutation = null;
	}
    }

    _objectIdFromFreelist() {
	let head = this._header.get32(HEADER.FREELIST);
	if (head === 0) {
	    // Freelist is empty, cannot allocate an object ID from there. 0 is a valid ID so we
	    // cannot use that as the "not found" marker.
	    return -1;
	}

	if ((head & 1) !== 1) {
	    throw new Error("impossible");  // Should have had the "freelist member" bit set
	}

	let objlist = this._arena.fromAddr(this._header.get32(HEADER.OBJLIST));
	this._header.set32(HEADER.FREELIST, objlist.get32(head >> 1));
	return head >> 1;
    }

    _objectIdToFreelist(id) {
	let objlist = this._arena.fromAddr(this._header.get32(HEADER.OBJLIST));
	let oldHead = this._header.get32(HEADER.FREELIST);
	objlist.set32(id, oldHead);
	this._header.set32(HEADER.FREELIST, (id << 1) | 1);
    }

    _allocateObjectId() {
	let fromFreelist = this._objectIdFromFreelist();
	if (fromFreelist !== -1) {
	    return fromFreelist;
	}

	let cap = this._header.get32(HEADER.OBJLIST_CAPACITY);
	let size = this._header.get32(HEADER.OBJLIST_SIZE);
	let objlist = this._arena.fromAddr(this._header.get32(HEADER.OBJLIST));

	if (size === cap) {
	    let newCap = cap + OBJLIST_INCREMENT;
	    let newObjlist = this._arena.alloc(newCap * 4);
	    debuglog("allocated new objlist of size " + newCap + " @ " + newObjlist._base);
	    if (cap !== 0) {
		for (let i = 0; i < size; i++) {
		    newObjlist.set32(i, objlist.get32(i));
		}

		this._arena.free(objlist);
	    }

	    this._header.set32(HEADER.OBJLIST, newObjlist._base);
	    this._header.set32(HEADER.OBJLIST_CAPACITY, newCap);
	    objlist = newObjlist;
	}

	this._header.set32(HEADER.OBJLIST_SIZE, size + 1);
	return size;
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

	// Register the object on the chain and thus make it eligible for GC.
	this._criticalSection.run(() => {
	    this._header.set32(
		HEADER.OBJECT_COUNT,
		this._header.get32(HEADER.OBJECT_COUNT) + 1);

	    let id = this._allocateObjectId();
	    let objlist = this._arena.fromAddr(this._header.get32(HEADER.OBJLIST));

	    // Releasing a lock is effectively a fence, so we don't need to put a fence between
	    // these two statement to make sure that by the time the new object is linked into the
	    // object list, its ID is recorded
	    priv._setId(id);
	    objlist.set32(id, ptr._base);
	    debuglog("assigned object ID " + id + " to object @ " + ptr._base);

	    if (EXTENDED_SANITY_CHECKS) {
		this._sanityCheckLocked();
	    }
	});

	return pub;
    }

    _dispose(priv) {
	this._addrToObject.delete(priv._ptr._base);

	this._withMutation(() => {
	    this._changeRefcount(priv._ptr, -THREAD_RC_DELTA, priv);
	});
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
	let type = localobject.LocalObject._getType(ptr.get32(1));
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
	if (this._mutation === null) {
	    throw new Error("impossible");
	}

	this._mutation.push({ objPtr: objPtr, delta: delta, priv: priv});
    }

    _commitRefcount(objPtr, delta, priv) {
	// TODO: This object creation is probably totally unnecessary, we have the address so all we
	// need to do is to acquire the lock
	let cs = new sync_internal.CriticalSection(
	    this._arena.int32, localobject.LocalObject._criticalSectionAddr(objPtr._base));

	cs.run(() => {
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

	    this._toFree.push(priv);
	});
    }

    _sanityCheckLocked() {
	let headerObjectCount = this._header.get32(HEADER.OBJECT_COUNT);
	let objlist = this._arena.fromAddr(this._header.get32(HEADER.OBJLIST));
	let objlistObjectCount = 0;
	let objlistFreelistCount = 0;

	for (let i = 0; i < this._header.get32(HEADER.OBJLIST_SIZE); i++) {
	    let entry = objlist.get32(i);
	    debuglog("objlist entry " + i + ": " + entry);
	    if (entry === 0) {
		// End of freelist marker. This counts as a freelist entry because if we ever
		// set an entry to zero, we have already freed at least one object
		objlistFreelistCount += 1;
	    } else if ((entry & 1) === 1) {
		objlistFreelistCount += 1;
	    } else {
		objlistObjectCount += 1;
	    }
	}

	if (objlistObjectCount !== headerObjectCount) {
	    throw new Error("object count in header/objlist is " +
			    headerObjectCount + "/" + objlistObjectCount);
	}

	let freelistLength = 0;
	let free = this._header.get32(HEADER.FREELIST);
	debuglog("freelist head: " + (free >> 1));
	while (free !== 0) {
	    freelistLength += 1;
	    free = objlist.get32(free >> 1);
	}

	if (objlistFreelistCount !== freelistLength) {
	    throw new Error("freelist length in chain/objlist is " +
			    freelistLength + "/" + objlistFreelistCount);
	}
    }
}

exports.World = World;
