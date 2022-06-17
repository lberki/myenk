"use strict";

const util = require("./util.js");
const debuglog = util.debuglog("sync_internal");

const LockState = {
    FREE: 0,
    LOCKED_NO_WAITERS: 1,
    LOCKED_MAYBE_WAITERS: 2,
};

const RwLockState = {
    WRITE_LOCKED: 0,
    FREE: 1,
};

const DEFAULT_TIMEOUT = 1000;

function acquireLock(_int32, _addr, timeout) {
    debuglog(`acquire ${_addr}`);
    if (timeout === undefined) {
	// It's possible that this function will wait longer than the specified timeout since we
	// dumbly pass it to Atomics.wait() and it's possible that it needs to be invoked more
	// than once, but since limited timeouts are only used for debugging and test cases, it's
	// good enough. Certainly preferable to monkeying around with querying the current time.
	timeout = DEFAULT_TIMEOUT;
    }

    let old = Atomics.compareExchange(_int32, _addr, LockState.FREE, LockState.LOCKED_NO_WAITERS);
    if (old === LockState.FREE) {
	debuglog(`acquire ${_addr} done`);	
	return;  // Fast path. No contention.
    }

    while (true) {
	// Signal that we are waiting for the lock.
	old = Atomics.exchange(_int32, _addr, LockState.LOCKED_MAYBE_WAITERS);

	if (old === LockState.FREE) {
	    // ...but if it was this thread that flipped the lock to non-free, it is ours.
	    debuglog(`acquire ${_addr} done`);	    
	    return;
	}

	// Otherwise, the lock is now in "locked with maybe waiters" state and we are one of
	// those waiters. Wait until the lock is unlocked.
	let result = Atomics.wait(_int32, _addr, LockState.LOCKED_MAYBE_WAITERS, timeout);
	if (result === "timed-out") {
	    throw new Error("timeout");
	}
    }
}

function releaseLock(_int32, _addr) {
    debuglog(`release ${_addr}`);
    
    let old = Atomics.exchange(_int32, _addr, LockState.FREE);
    if (old === LockState.LOCKED_MAYBE_WAITERS) {
	// If there may be waiters, signal one of them. If there weren't, the only harm done is
	// an extra system call.
	Atomics.notify(_int32, _addr, 1);
    }

    debuglog(`release ${_addr} done`);    
}

class CriticalSection {
    constructor(_int32, _addr) {
	this._int32 = _int32;
	this._addr = _addr;
    }

    run(l) {
	acquireLock(this._int32, this._addr);
	try {
	    return l();
	} finally {
	    releaseLock(this._int32, this._addr);
	}
    }

    wrap(obj, f) {
	return (...args) => {
	    return this.run(() => {
		return f.call(obj, ...args);
	    });
	}
    }
}

function readRwLock(_int32, _addr, timeout) {
    debuglog(`rw read ${_addr}`);
    
    if (timeout === undefined) {
	timeout = DEFAULT_TIMEOUT;
    }

    while (true) {
	let current = _int32[_addr];
	let wait = false;
	if (current !== RwLockState.WRITE_LOCKED) {
	    let oldCurrent = current;
	    current = Atomics.compareExchange(_int32, _addr, oldCurrent, oldCurrent + 1);
	    if (oldCurrent === current) {
		break;
	    }
	}

	if (Atomics.wait(_int32, _addr, current, timeout) === "timed-out") {
	    throw new Error("timeout");
	}
    }

    debuglog(`rw read ${_addr} done`);    
}

function writeRwLock(_int32, _addr, timeout) {
    debuglog(`rw write ${_addr}`);

    if (timeout === undefined) {
	timeout = DEFAULT_TIMEOUT;
    }

    while (true) {
	let current = Atomics.compareExchange(_int32, _addr, RwLockState.FREE, RwLockState.WRITE_LOCKED);
	if (current === RwLockState.FREE) {
	    break;
	}

	let result = Atomics.wait(_int32, _addr, current, timeout);
	if (result === "timed-out") {
	    throw new Error("timeout");
	} else if (result === "not-equal") {
	    continue;
	} else {
	    if (_int32[_addr] !== RwLockState.FREE) {
		Atomics.notify(_int32, _addr, 1);
	    }
	}
    }

    debuglog(`rw write ${_addr} done`);    
}

function upgradeRwLock(_int32, _addr, timeout) {
    debuglog(`rw upgrade ${_addr}`);
    
    if (timeout === undefined) {
	timeout = DEFAULT_TIMEOUT;
    }

    while (true) {
	let current = Atomics.compareExchange(_int32, _addr, RwLockState.FREE + 1, RwLockState.WRITE_LOCKED);
	if (current === RwLockState.FREE + 1) {
	    break;
	}

	let result = Atomics.wait(_int32, _addr, current, timeout);
	if (result === "timed-out") {
	    throw new Error("timeout");
	} else if (result === "not-equal") {
	    continue;
	} else {
	    if (_int32[_addr] !== RwLockState.FREE + 1) {
		Atomics.notify(_int32, _addr, 1);
	    }
	}
    }

    debuglog(`rw upgrade ${_addr} done`);    
}

function releaseRwLock(_int32, _addr) {
    debuglog(`rw release ${_addr}`);
    
    while (true) {
	let current = _int32[_addr];
	let wanted = current === RwLockState.WRITE_LOCKED ? RwLockState.FREE : current - 1;
	if (Atomics.compareExchange(_int32, _addr, current, wanted) === current) {
	    break;
	}
    }

    Atomics.notify(_int32, _addr, 1);
    debuglog(`rw release ${_addr} done`);    
}


exports.LOCK_FREE = LockState.FREE;
exports.acquireLock = acquireLock;
exports.releaseLock = releaseLock;
exports.RWLOCK_FREE = RwLockState.FREE;
exports.readRwLock = readRwLock;
exports.writeRwLock = writeRwLock;
exports.upgradeRwLock = upgradeRwLock;
exports.releaseRwLock = releaseRwLock;
exports.CriticalSection = CriticalSection;
exports.DEFAULT_TIMEOUT = DEFAULT_TIMEOUT;
