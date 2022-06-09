"use strict";

const util = require("../util.js");
const debuglog = util.debuglog("test");

let testutil = require("./testutil.js");

let world = require("../world.js");

function latchSmokeTest(w, t) {
    w.root().foo += " worker1";
    t.done("one");
    t.wait("two");
    w.root().foo += " worker3";
    t.done("three");
    t.wait("four");
    w.root().foo += " worker5";
    t.done("five");
}

function lockStressTest(w, t, param) {
    let lock = w.root().lock;
    let latch = w.root()["latch_" + param];

    w.root().start.wait();

    for (let i = 1; i <= 4000; i++) {
	lock.lock();
	w.root().foo += i;
	lock.unlock();
    }

    latch.dec();
}

function rwLockSmoke1(w, t, param) {
    let lock = w.root().rwlock;
    w.root().start1.wait();
    lock.read();
    w.root().result += " rlock";
    w.root().rlocked1.dec();
    w.root().unlock1.wait();
    w.root().result += " runlock";
    lock.unlock();
    w.root().done1.dec();
    w.root().join.dec();
}

function rwLockSmoke2(w, t, param) {
    let lock = w.root().rwlock;
    w.root().start2.wait();
    lock.read();
    w.root().result += " rlock";
    w.root().rlocked2.dec();
    w.root().unlock2.wait();
    w.root().result += " runlock";
    lock.unlock();
    w.root().join.dec();
}

function rwLockSmoke3(w, t, param) {
    let lock = w.root().rwlock;
    w.root().start3.wait();
    lock.write();
    w.root().result += " wlock";
    w.root().result += " wunlock";
    lock.unlock();
    w.root().join.dec();
}

function rwLockSmoke4(w, t, param) {
    let lock = w.root().rwlock;
    w.root().start4.wait();
    lock.write();
    w.root().result += " wlock";
    w.root().result += " wunlock";
    lock.unlock();
    w.root().join.dec();
}

function rwLockStressTestRead(w, t, param) {
    let rwlock = w.root().rwlock;

    w.root().start.wait();

    for (let i = 1; i <= 2000; i++) {
	rwlock.read();
	rwlock.unlock();
    }

    w.root().join.dec();
}

function rwLockStressTestWrite(w, t, param) {
    let rwlock = w.root().rwlock;

    w.root().start.wait();

    for (let i = 1; i <= 2000; i++) {
	rwlock.write();
	w.root().foo += i;
	rwlock.unlock();
    }

    w.root().join.dec();
}

exports.latchSmokeTest = latchSmokeTest;
exports.lockStressTest = lockStressTest;
exports.rwLockSmoke1 = rwLockSmoke1;
exports.rwLockSmoke2 = rwLockSmoke2;
exports.rwLockSmoke3 = rwLockSmoke3;
exports.rwLockSmoke4 = rwLockSmoke4;
exports.rwLockStressTestRead = rwLockStressTestRead;
exports.rwLockStressTestWrite = rwLockStressTestWrite;
