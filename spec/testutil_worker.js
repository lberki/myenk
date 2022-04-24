"use strict";

let worker_threads = require("worker_threads");

let world = require("../world.js");

let w = world.World.existing(worker_threads.workerData.buffer);
let workerModule = require("./" + worker_threads.workerData.js);
workerModule[worker_threads.workerData.fn](w);
