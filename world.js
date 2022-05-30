"use strict";

const util = require("util");
const debuglog = util.debuglog("world");

let arena = require("./arena.js");
let sharedobject = require("./sharedobject.js");
let dictionary = require("./dictionary.js");
let localobject = require("./localobject.js");
let sharedsymbol = require("./sharedsymbol.js");
let array = require("./array.js");
let sync = require("./sync.js");
let sync_internal = require("./sync_internal.js");


const EXTENDED_SANITY_CHECKS = true;

const PRIVATE = Symbol("World private data");

const HEADER_SIZE = 32;
const OBJECT_SIZE = 16;
const MAGIC = 0x1083041d;
const THREAD_RC_DELTA = 2000;    // Change in refcount for references from threads
const WORLD_RC_DELTA = 2;        // Change in refcount for references from within the world
const OBJLIST_INCREMENT = 4;     // Small enough to get triggered in test cases

const ObjectTypes = [
    null,  // marker so that zero is not a valid object type in RAM,
    dictionary.Dictionary,
    array.Array,
    localobject.LocalObject,
    sharedsymbol.SharedSymbol,
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
	this._addrToPublic = new Map();
	this._localToPrivate = new Map();
	this._symbolToPrivate = new Map();
	this._registry = new FinalizationRegistry(priv => { this._dispose(priv); });
	this._mutation = null;
	this._criticalSection = new sync_internal.CriticalSection(
	    this._arena.int32,
	    (header._base + arena.BLOCK_HEADER_SIZE) / 4 + 3);
	this.sanityCheck = this._criticalSection.wrap(this, this._sanityCheckLocked);
	this.localSanityCheck = this._criticalSection.wrap(this, this._localSanityCheckLocked);
	this.gc = this._criticalSection.wrap(this, this._gcLocked);
	this.emptyDumpster = this._criticalSection.wrap(this, this._emptyDumpsterLocked);

	// Every thread gets its own dumpster so it's appropriate to allocate it in the constructor
	this._dumpster = this._arena.alloc(8);
	this._dumpster.set32(0, 0);
	this._dumpster.set32(1, 0);
	debuglog("allocated dumpster @ " + this._dumpster._base);
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
	    result._root = result._publicFromAddr(header.get32(HEADER.ROOT));
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

    deepCopy(v) {
	return this._deepCopyRecursive(v, new Map());
    }

    _deepCopyRecursive(v, map) {
	if (v === undefined) {
	    return undefined;
	}

	if (v === null) {
	    return null;
	}

	if (typeof(v) === "boolean") {
	    return v;
	}

	if (typeof(v) === "number") {
	    // TODO: range + integerness check
	    return v;
	}

	if (typeof(v) === "symbol") {
	    throw new Error("not implemented");
	}

	if (typeof(v) === "string") {
	    return v;
	}

	if (v instanceof Array) {
	    let result = map.get(v);
	    if (result !== undefined) {
		return result;
	    }

	    result = this.createArray();
	    map.set(v, result);

	    if (v.length === 0) {
		return result;
	    }

	    result[v.length - 1] = null;  // Prevent multiple reallocations
	    for (let i = 0; i < v.length; i++) {
		result[i] = this._deepCopyRecursive(v[i], map);
	    }

	    return result;
	}

	if (v[PRIVATE] !== undefined) {
	    // An object under our control (maybe not in this world!)
	    if (v[PRIVATE]._world !== this) {
		throw new Error("not supported");
	    }

	    return v;
	}

	if (typeof(v) === "object") {
	    if (v.__proto__ !== Object.prototype) {
		// This is not a simple dictionary, would be complicated to support
		throw new Error("not supported");
	    }

	    let result = map.get(v);
	    if (result !== undefined) {
		return result;
	    }

	    result = this.createDictionary();
	    map.set(v, result);

	    for (let k in v) {
		result[k] = this._deepCopyRecursive(v[k], map);
	    }

	    return result;
	}

	throw new Error("not supported");
    }

    createDictionary(...args) {
	return this._createObject(dictionary.Dictionary, ...args);
    }

    createArray(...args) {
	return this._createObject(array.Array, ...args);
    }

    createLatch(...args) {
	return this._createObject(sync.Latch, ...args);
    }

    createLock(...args) {
	return this._createObject(sync.Lock, ...args);
    }

    _registerSymbol(sym) {
	let priv = this._symbolToPrivate.get(sym);
	if (priv !== undefined) {
	    return priv;
	}

	// Not registered. Create an object in shared storage.

	// Allocate memory as usual and register in the address-to-public map.
	let ptr = this._arena.alloc(OBJECT_SIZE);
	debuglog("allocated local symbol @ " + ptr._base);

	[priv, ] = sharedsymbol.SharedSymbol._create(this, this._arena, ptr);

	// We can't have a WeakRef here because WeakRefs can't reference Symbols but we don't need
	// that because we keep a reference to the object in _symbolToPrivate anyway
	this._addrToPublic.set(ptr._base, sym);

	priv._init(sym);

	// Symbols are never garbage collected since the JS garbage collector does not tell us when
	// they are not needed anymore, but let's keep the refcount in order anyway. Reasoning for
	// the zero is same as in _registerLocalObject().
	priv._ptr.set32(3, 0);

	this._symbolToPrivate.set(sym, priv);
	this._registerObjectForGc(priv);
	return priv;
    }

    _registerLocalObject(obj) {
	let priv = this._localToPrivate.get(obj);
	if (priv !== undefined) {
	    // Already registered. Check if it's in the dumpster.
	    let ok = false;
	    priv._criticalSection.run(() => {
		ok = (priv._ptr.get32(0) & 1) === 0;
	    });

	    if (ok) {
		return priv;
	    }

	    debuglog("object @ " + priv._ptr._base + " is in dumpster");

	    // Since the dumpster is a singly-linked list, removing an item from the middle is not
	    // possible without iterating over it. Instead, mark it as "freed" so that when the
	    // dumpster is emptied, it won't be removed from the local maps again.
	    priv._ptr.set32(0, priv._ptr.get32(0) & ~1);
	    if (!this._addrToPublic.delete(priv._ptr._base)) {
		// The object should be in addrToPublic because it's in the dumpster but not marked
		// as freed
		throw new Error("impossible");
	    }
	}

	// Not registered. Create an object in shared storage.

	// Allocate memory as usual and register in the address-to-public map.
	let ptr = this._arena.alloc(OBJECT_SIZE);
	debuglog("allocated localobject @ " + ptr._base + ", thread " + this._dumpster._base);

	[priv, ] = localobject.LocalObject._create(this, this._arena, ptr);

	// _localToPrivate references this object anyway so there is not much point in wrapping it
	// in a WeakRef. This makes _addrToPublic heterogenous, but hey, this is JavaScript. We can
	// fix this later by using two maps and choosing them based on object type.
	this._addrToPublic.set(ptr._base, obj);

	// Initialization is a little different: we don't pass any arguments since there is nothing
	// other threads can usefully know about this object. Calling this method is a signal that
	// the LocalObject instance refers to an object that lives on this thread.
	priv._init();

	// Differently from every other object, we do *not* add a thread reference to them. This is
	// because we want the shared object garbage collected if this thread is the only one that
	// has a reference to the associated object.
	priv._ptr.set32(3, 0);

	this._localToPrivate.set(obj, priv);
	this._registerObjectForGc(priv);
	return priv;
    }

    // Start a mutation that is then ignored. This is used during garbage collection when freeing
    // objects. Those are already proven not to be accessible, so there is no point in
    // meticulously keeping track of refcounts of objects only accessible from them.
    _withIgnoredMutation(l) {
	if (this._mutation !== null) {
	    throw new Error("impossible");
	}

	// TODO: We could special-case this so that the mutations are not even collected
	this._mutation = [];
	try {
	    return l();
	} finally {
	    this._mutation = null;
	}
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
	    let objectsToFree = [];

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
		    debuglog("marking object ID " + priv._getId() + " with object @ " +
			     priv._ptr._base + " as freeable");
		    objectsToFree.push(priv);

		    // This does not free the object header. This is so that pointer in the global
		    // object list stays valid. It will be freed when we deallocate the object IDs
		    // later.
		    priv._free();
		}

		// ...and continue recording the mutations caused by freeing objects, if needed.
	    }

	    this._criticalSection.run(() => {
		// Decrease object count
		this._header.set32(
		    HEADER.OBJECT_COUNT,
		    this._header.get32(HEADER.OBJECT_COUNT) - objectsFreed);

		for (let obj of objectsToFree) {
		    this._freeObjectLocked(obj);
		}

		if (EXTENDED_SANITY_CHECKS) {
		    this._sanityCheckLocked();
		}
	    });

	    this._toFree = null;
	    this._mutation = null;
	}
    }

    _freeObjectLocked(obj) {
	this._objectIdToFreelist(obj._getId());

	if (obj._useDumpster()) {
	    debuglog("moving object @ " + obj._ptr._base + " to dumpster");
	    this._addToDumpsterLocked(obj);
	} else {
	    debuglog("freeing object @ "+ obj._ptr._base);
	    this._arena.free(obj._ptr);
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

    _registerObjectForGc(priv) {
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
	    objlist.set32(id, priv._ptr._base);
	    debuglog("assigned object ID " + id + " to object @ " + priv._ptr._base);

	    if (EXTENDED_SANITY_CHECKS) {
		this._sanityCheckLocked();
	    }
	});
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
	this._registerObjectForGc(priv);
	return pub;
    }

    _dispose(priv) {
	if (priv._useDumpster() && priv._ownThread) {
	    // These objects are not registered in the FinalizationRegistry
	    throw new Error("impossible");
	}
	this._addrToPublic.delete(priv._ptr._base);

	this._withMutation(() => {
	    this._changeRefcount(priv._ptr, -THREAD_RC_DELTA, priv);
	});
    }

    _registerObject(priv, pub, addr) {
	if (typeof(pub) === "symbol") {
	    // Special case: Symbols are not objects so weak references cannot point to them. So
	    // do not wrap them with a weak reference. This of course means that shared symbols that
	    // have references to them from other threads will never get garbage collected but there
	    // does not seem to be a way to make that work. This also conveniently means that we
	    // never have to clean up _symbolToPrivate.
	    this._addrToPublic.set(addr, pub);
	    this._symbolToPrivate.set(pub, priv);
	} else {
	    let wr = new WeakRef(pub);
	    this._registry.register(pub, priv);
	    this._addrToPublic.set(addr, wr);
	}
    }

    _createObjectPair(addr) {
	let ptr = this._arena.fromAddr(addr);
	let type = sharedobject.SharedObject._getType(ptr.get32(1));
	if (type <= 0 || type >= ObjectTypes.length) {
	    throw new Error("invalid object type in shared buffer: " + type);
	}

	return ObjectTypes[type]._create(this, this._arena, ptr);
    }

    _publicFromAddr(addr, forGc=false) {
	let wr = this._addrToPublic.get(addr);
	if (wr instanceof WeakRef) {
	    // Do not call deref() twice in case Javascript GC happens in between
	    let existing = wr.deref();
	    if (existing !== undefined) {
		return existing;
	    }
	} else if (wr !== undefined) {
	    return wr;
	}

	let [priv, pub] = this._createObjectPair(addr);
	if (!forGc) {
	    this._changeRefcount(priv._ptr, THREAD_RC_DELTA);
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

	this._mutation.push({ objPtr: objPtr, delta: delta, priv: priv });
    }

    _commitRefcount(objPtr, delta, priv) {
	// TODO: This object creation is probably totally unnecessary, we have the address so all we
	// need to do is to acquire the lock
	let cs = new sync_internal.CriticalSection(
	    this._arena.int32, sharedobject.SharedObject._criticalSectionAddr(objPtr._base));

	cs.run(() => {
	    let oldRefcount = objPtr.get32(3);
	    if (oldRefcount === 0) {
		// TODO: re-enable this after figuring out how to make the creation of a LocalObject
		// not trigger it
		// throw new Error("impossible");
	    }

	    let newRefcount = oldRefcount + delta;
	    objPtr.set32(3, newRefcount);
	    if (newRefcount !== 0) {
		return;
	    }

	    if (priv === null) {
		// We need to have a local object so that we can properly deallocate the data
		// structures in the arena allocated by the world object
		let pub = this._publicFromAddr(objPtr._base, true);
		priv = pub[PRIVATE];
		if (priv === undefined) {
		    // local objects are kept in a map instead so that they are not modified
		    priv = this._localToPrivate.get(pub);
		}
	    }

	    this._toFree.push(priv);
	});
    }

    _emptyDumpsterLocked() {
	let addr = this._dumpster.get32(0);

	while (addr !== 0) {
	    // The object does not need to be locked because now that it's in the dumpster, no other
	    // thread can access it
	    debuglog("freeing object @ " + addr + " from dumpster");
	    let ptr = this._arena.fromAddr(addr);
	    let next = ptr.get32(0) & ~1;
	    let removeFromMaps  = (ptr.get32(0) & 1) === 1;

	    this._arena.free(ptr);

	    if (removeFromMaps) {
		let pub = this._addrToPublic.get(addr);
		let priv = this._localToPrivate.get(pub);
		if (priv === null) {
		    throw new Error("impossible");
		}

		// The object must be unreferenced and local objects don't reference any shared
		// object so all we need to do is to free the shared storage and remove the local
		// references to the wrapped object
		if (!this._localToPrivate.delete(pub)) {
		    throw new Error("impossible");
		}

		if (!this._addrToPublic.delete(addr)) {
		    throw new Error("impossible");
		}
	    }

	    addr = next;
	}

	this._dumpster.set32(0, 0);
    }

    _addToDumpsterLocked(obj) {
	// This needs both the world lock and the object lock because even though the object is
	// unreferenced, it may still be mutated by its owning thread. The fix would be either
	// to use an array instead of a linked list for the dumpster.
	obj._criticalSection.run(() => {
	    let dumpsterPtr = this._arena.fromAddr(obj._ptr.get32(0));
	    let oldHead = dumpsterPtr.get32(0);

	    obj._ptr.set32(0, oldHead | 1);
	    dumpsterPtr.set32(0, obj._ptr._base);
	});
    }

    _gcLocked() {
	// GC is one of the few times when a thread holds more than one lock (the world lock + a
	// single object lock)

	// Collect all the GC roots (objects referenced from other threads)
	let objlist = this._arena.fromAddr(this._header.get32(HEADER.OBJLIST));
	let roots = [];

	debuglog("starting GC");

	for (let i = 0; i < this._header.get32(HEADER.OBJLIST_SIZE); i++) {
	    let addr = objlist.get32(i);
	    if ((addr & 1) === 1 || addr === 0) {
		// This is a freelist entry
		continue;
	    }

	    let [obj, ] = this._createObjectPair(addr);
	    obj._criticalSection.run(() => {
		if (obj._ptr.get32(3) >= THREAD_RC_DELTA) {
		    roots.push(obj);
		    debuglog("found root @ " + addr);
		}
	    });
	}

	// Mark every object transitively reachable from GC roots
	let queue = [];
	queue.push(...roots);

	while (queue.length > 0) {
	    let obj = queue.shift();
	    obj._criticalSection.run(() => {
		let old = obj._ptr.get32(3);
		if ((old & 1) === 1) {
		    // Already visited
		    return;
		}

		if (old === 0) {
		    // Slated for freeing, which means that nothing is reachable from this object
		    return;
		}

		// Mark as reachable, enqueue objects referenced
		obj._ptr.set32(3, old | 1);
		debuglog("marking object @ " + obj._ptr._base + " as live");
		for (let addr of obj._references()) {
		    // TODO: it's probably quite wasteful to always create a new local object even
		    // though it's already been visited
		    let [priv, ] = this._createObjectPair(addr);
		    debuglog("enqueuing edge @ " + obj._ptr._base + " -> @ " + addr);
		    queue.push(priv);
		}
	    });
	}

	// Iterate over every object and free those without the GC mark
	let objectsFreed = [];

	for (let i = 0; i < this._header.get32(HEADER.OBJLIST_SIZE); i++) {
	    let addr = objlist.get32(i);
	    if ((addr & 1) === 1 || addr === 0) {
		// This is a freelist entry
		continue;
	    }

	    let [obj, _] = this._createObjectPair(addr);
	    obj._criticalSection.run(() => {
		let rc = obj._ptr.get32(3);
		if (rc === 0) {
		    // Will be freed by someone else.
		    return;
		}

		if ((rc & 1) === 1) {
		    debuglog("object @ " + obj._ptr._base + " is live");
		    // Marked as reachable. Remove mark and continue
		    // TODO: we could avoid removing the mark if we flipped the meaning of the mark
		    // bit on every GC cycle
		    obj._ptr.set32(3, rc & ~1);
		    return;
		}

		// Can be GCd. Free all data structures, unlink from object ID list.
		debuglog("object @ " + obj._ptr._base + " is unreachable, freeing");
		this._withIgnoredMutation(() => {
		    obj._free();
		});

		objectsFreed.push(obj);
	    });
	}

	for (let obj of objectsFreed) {
	    this._freeObjectLocked(obj);
	}

	this._header.set32(
	    HEADER.OBJECT_COUNT,
	    this._header.get32(HEADER.OBJECT_COUNT) - objectsFreed.length);

	if (EXTENDED_SANITY_CHECKS) {
	    this._sanityCheckLocked();
	}
    }

    _localSanityCheckLocked() {
	let objlist = this._arena.fromAddr(this._header.get32(HEADER.OBJLIST));

	let objectsLeft = new Set();
	let symbolsLeft = new Set();

	for (let priv of this._localToPrivate.values()) {
	    objectsLeft.add(priv._ptr._base);
	}

	for (let priv of this._symbolToPrivate.values()) {
	    symbolsLeft.add(priv._ptr._base);
	}

	let checkObject = (addr) => {
	    let pub = this._addrToPublic.get(addr);
	    let priv;
	    if (typeof(pub) === "symbol") {
		priv = this._symbolToPrivate.get(pub);
		if (!(symbolsLeft.delete(addr))) {
		    throw new Error("symbol @ " + addr + " is not in local map");
		}
	    } else {
		priv = this._localToPrivate.get(pub);
		if (!(objectsLeft.delete(addr))) {
		    throw new Error("localobject @ " + addr + " is not in local map");
		}
	    }

	    if (priv._ptr._base !== addr) {
		throw new Error("localobject/symbol @ " + addr + " maps to one @ " + priv._ptr._base);
	    }
	};

	for (let i = 0; i < this._header.get32(HEADER.OBJLIST_SIZE); i++) {
	    let entry = objlist.get32(i);
	    if (entry === 0) {
		// Freelist entry of end marker
		continue;
	    } else if ((entry & 1) === 1) {
		// Freelist entry. IDs of objects in the dumpster can be reused so we can't check
		// anything useful here.
	    } else {
		let [obj, ] = this._createObjectPair(entry);
		if (obj instanceof localobject.LocalObject) {
		    if (obj._dumpsterAddr() !== this._dumpster._base) {
			// A localobject for a different thread
			continue;
		    }

		    checkObject(entry);
		} else if (obj instanceof sharedsymbol.SharedSymbol) {
		    let sym = this._addrToPublic.get(entry);
		    let priv2 = this._symbolToPrivate.get(sym);
		    if (!(symbolsLeft.delete(entry))) {
			throw new Error("symbol @ " + entry + " is not in local map");
		    }

		    if (priv2._ptr._base !== entry) {
			throw new Error("localobject/symbol @ " + entry + " maps to one @ " + priv2._ptr._base);
		    }
		}
	    }
	}

	let addr = this._dumpster.get32(0);
	while (addr !== 0) {
	    let ptr = this._arena.fromAddr(addr);
	    let next = ptr.get32(0) & ~1;
	    let removed = (ptr.get32(0) & 1) === 0;

	    if (removed) {
		if (this._addrToPublic.has(addr)) {
		    throw new Error("object @ " + addr + " removed from dumpster has map entry");
		}
	    } else {
		checkObject(addr);
	    }

	    addr = next;
	}

	for (let left of objectsLeft) {
	    throw new Error("localobject @ " + left + " in local map was not on object list");
	}

	for (let left of symbolsLeft) {
	    throw new Error("symbol @ " + left + " in local map was not on object list");
	}
    }

    _sanityCheckLocked() {
	let headerObjectCount = this._header.get32(HEADER.OBJECT_COUNT);
	let objlist = this._arena.fromAddr(this._header.get32(HEADER.OBJLIST));
	let objlistObjectCount = 0;
	let objlistFreelistCount = 0;

	for (let i = 0; i < this._header.get32(HEADER.OBJLIST_SIZE); i++) {
	    let entry = objlist.get32(i);
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

sharedobject.setPrivateSymbol(PRIVATE);
exports.World = World;
