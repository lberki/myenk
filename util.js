"use strict";

const worker_threads = require("worker_threads");

function debuglog(t) {
    if (!("NODE_DEBUG" in process.env)) {
	return () => {};
    }

    let modules = process.env["NODE_DEBUG"].split(",");
    if (modules.indexOf(t) >= 0) {
	return (fmt, ...args) => {
	    console.log("[%d] %s %s: " + fmt, worker_threads.threadId, new Date().toISOString(), t, ...args)
	};
    } else {
	return () => {};
    }
}

exports.debuglog = debuglog;
