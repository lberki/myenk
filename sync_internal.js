"use strict";

const LockState = {
    FREE: 0,
    LOCKED_NO_WAITERS: 1,
    LOCKED_MAYBE_WAITERS: 2
};

const DEFAULT_TIMEOUT = 1000;

function acquireLock(_int32, _addr, timeout) {
    if (timeout === undefined) {
	// It's possible that this function will wait longer than the specified timeout since we
	// dumbly pass it to Atomics.wait() and it's possible that it needs to be invoked more
	// than once, but since limited timeouts are only used for debugging and test cases, it's
	// good enough. Certainly preferable to monkeying around with querying the current time.
	timeout = DEFAULT_TIMEOUT;
    }

    let old = Atomics.compareExchange(_int32, _addr, LockState.FREE, LockState.LOCKED_NO_WAITERS);
    if (old === LockState.FREE) {
	return;  // Fast path. No contention.
    }

    while (true) {
	// Signal that we are waiting for the lock.
	old = Atomics.exchange(_int32, _addr, LockState.LOCKED_MAYBE_WAITERS);

	if (old === LockState.FREE) {
	    // ...but if it was this thread that flipped the lock to non-free, it is ours.
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
    let old = Atomics.exchange(_int32, _addr, LockState.FREE);
    if (old === LockState.LOCKED_MAYBE_WAITERS) {
	// If there may be waiters, signal one of them. If there weren't, the only harm done is
	// an extra system call.
	Atomics.notify(_int32, _addr, 1);
    }
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

exports.acquireLock = acquireLock;
exports.releaseLock = releaseLock;
exports.CriticalSection = CriticalSection;
exports.DEFAULT_TIMEOUT = DEFAULT_TIMEOUT;
