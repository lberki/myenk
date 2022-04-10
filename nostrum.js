"use strict";

const DEFAULT_SIZE = 1024;

class ProxyHandler {
    constructor(obj) {
	this.obj = obj;
    }

    // Methods that probably don't make sense
    
    apply(target, thisArg, args) {
	throw new Error("apply() should never be called");
    }

    construct(target, args) {
	throw new Error("TODO");
    }


    // Adding, deleting, checking properties, etc.

    // Don't forget Symbol keys
    has(target, prop) {
	return prop in this.obj.backingStore;
    }

    deleteProperty(target, prop) {
	delete this.obj.backingStore[prop];
	return true;
    }
    
    set(target, prop, value) {
	this.obj.backingStore[prop] = value;
	return true;
    }
    
    get(target, prop, receiver) {
	// Target is apparently where the prop is defined (can be prototype)
	// Receiver is the original receiver of the method call
	return this.obj.backingStore[prop];
    }
    
}

class SharedObject {
    constructor() {
	this.backingStore = {};  // To test the protocol
	this.buffer = new SharedArrayBuffer(DEFAULT_SIZE);
	this.handler = new ProxyHandler(this);
    }
}

function create() {
    let obj = new SharedObject();
    return new Proxy(obj, obj.handler);
}

exports.create = create;
