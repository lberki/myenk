# Myenk: true shared memory concurrency in Javascript

This library makes it possible to share data structures between multiple JS
threads running on the same VM.

Impossible at first glance, this is achieved by reimplementing JS data
structures with `SharedArrayBuffer` as backing store. Arrays and objects are
implemented. The code tries to emulate these data structures as closely as
possible while staying simple. 

Some synchronization primitives are also provided (`Lock` and `RwLock`).

Access to individual arrays and objects is protected by a lock, so individual
operations on them are atomic.

Garbage collection is achieved by a combination of reference counting and
tracing: if the last reference to an object is removed, it is freed, but a
`.gc()` method is also provided to clean up reference cycles. The garbage
collector is a simple stop-the-world one.

Limitations:
* Code cannot be shared between threads. Functions defined on one thread cannot
  be invoked from another.
* Objects are implemented mostly as dictionaries. Prototype chains, etc. are
  not available.
* Symbols are never garbage collected.
* When the last reference to a "native" object is in the shared buffer and it
  goes away, the object is only garbage collected after an explicit "clean up
  unreferenced local objects" call. This is because this last reference can be
  removed from another thread and one thread cannot cause the garbage
  collection of a native object on another thread.
* The simple implementation makes the code quite slow (it was never benchmarked
  but don't expect much)

For examples and copy-paste material, see the test battery.
