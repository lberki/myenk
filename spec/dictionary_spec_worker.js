"use strict";

let worker_threads = require("worker_threads");

const signal = new Int32Array(worker_threads.workerData.signal);

function finish() {
    Atomics.notify(signal, 0);
}

function smokeTest() {
    finish();
}

smokeTest();
