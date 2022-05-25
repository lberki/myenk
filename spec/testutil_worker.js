"use strict";

const util = require("util");
const debuglog = util.debuglog("testutil_worker");

class MainProxy {
    constructor(w) {
	this._w = w;
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

let worker_threads = require("worker_threads");

let world = require("../world.js");

debuglog("spawning worker thread " + worker_threads.workerData.fn);

let w = world.World.existing(worker_threads.workerData.buffer);
let workerModule = require("./" + worker_threads.workerData.js);

let result = workerModule[worker_threads.workerData.fn](
    w,
    new MainProxy(w),
    worker_threads.workerData.param);
