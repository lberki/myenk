"use strict";

const worker_threads = require("worker_threads");

let print;

try {
    print = require("bindings")("nativelog").print;
} catch (e) {
    print = console.log;
}

function debuglog(tag) {
    if (!("NODE_DEBUG" in process.env)) {
	return () => {};
    }

    let debugtags = process.env["NODE_DEBUG"].split(",");
    if (debugtags.indexOf(tag) >= 0) {
	return (msg) => {
	    let threadId = worker_threads.threadId;
	    let time = new Date().toISOString();

	    print(`[${threadId}] ${time} ${tag}: ${msg}`);
	};
    } else {
	return () => {};
    }
}

exports.debuglog = debuglog;
