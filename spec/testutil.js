"use strict";

const util = require("util");
const debuglog = util.debuglog("testutil_worker");
const worker_threads = require("worker_threads");

let world = require("../world.js");

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

// I have no idea why *two* event loop iterations need to happen before objects with weak references
// to them are finalized and their FinalizationRegistry handlers are called but that's demonstrably
// the case, at least in Node v16.14.2.
async function forceGc() {
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
    w.root().__testLatches = w.createDictionary();
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

exports.sleep = sleep;
exports.forceGc = forceGc;
exports.spawnWorker = spawnWorker;
