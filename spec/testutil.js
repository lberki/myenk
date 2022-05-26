"use strict";

const util = require("util");
const debuglog = util.debuglog("testutil_worker");
const worker_threads = require("worker_threads");

let world = require("../world.js");

function checkArray(actual, ...expected) {
    for (let i = 0;  i < expected.length; i++) {
	expect(actual[i]).toBe(expected[i]);
    }
}

// Marsaglia xorshift32 algorithm
class PRNG {
    constructor(seed) {
	this._state = seed;
    }

    next() {
	let x = this._state;
	x ^= x << 13;
	x ^= x >> 17;
	x ^= x << 5;
	this._state = x;

	// Only 31 bits of randomness, but no annoying negative numbers
	return x & 0x7fffffff;
    }

    upto(n) {
	// This is, of course, hilariously biased. For our purposes, it will do.
	return this.next() % n;
    }
}

function sleep(ms) {
    return new Promise(resolve => {
	setTimeout(() => { resolve(null); }, ms);
    });
}

// Resolves the promise in the next iteration of the event loop.
// Used to try to make sure garbage collection happens when expected. There are no official
// guarantees, but it seems to work and is useful for testing.
function nextEvent() {
    return new Promise(resolve => {
	setImmediate(() => { resolve(null) });
    });
}

// I have no idea why *three* event loop iterations need to happen before objects with weak
// references to them are finalized and their FinalizationRegistry handlers are called but two are
// definitely needed, at least in Node v16.14.2, and three was necessary in one test case. The more
// the merrier!
async function forceGc() {
    await nextEvent();
    global.gc();
    await nextEvent();
    global.gc();
    await nextEvent();
}

class WorkerProxy {
    constructor(w, worker) {
	this._w = w;
	this._worker = worker;
    }

    wait(name) {
	debuglog("wait " + name);
	this._w.root().__testLatches[name].wait();
    }

    done(name) {
	debuglog("done " + name);
	this._w.root().__testLatches[name].dec();
    }
}

function spawnWorker(w, js, fn, param, latches) {
    if (!("__testLatches" in w.root())) {
	w.root().__testLatches = w.createDictionary();
    }

    for (let l of latches) {
	w.root().__testLatches[l] = w.createLatch(1);
    }

    let worker = new worker_threads.Worker("./spec/testutil_worker.js", {
	workerData: {
	    js: js,
	    fn: fn,
	    param: param,
	    buffer: w.buffer(),
	    latches: latches
	}
    });

    return new WorkerProxy(w, worker);
}

exports.checkArray = checkArray;
exports.sleep = sleep;
exports.forceGc = forceGc;
exports.spawnWorker = spawnWorker;
exports.PRNG = PRNG;
