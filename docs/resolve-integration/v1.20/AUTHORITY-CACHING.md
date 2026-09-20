# AUTHORITY-CACHING.md — what an authority evaluator may remember (v1.7, FROZEN_NOW)

Correction of Codex v1.6 BLOCKER **C16-B1**: *content-insensitive authority caches allow stale or modified evidence,
parser, spec, refreeze and matrix state to remain qualified.*

## What went wrong in v1.6

v1.6 memoized derived authority results for speed. The keys were Python object identities:

| cache | v1.6 key | what it meant |
|---|---|---|
| qualification | `(id(caps), id(es), id(rp), method, canon(active))` | two different contents at one address share one answer |
| primitive spec digest | `id(rp)` plus a length | an edited expectation kept the old digest |
| evidence record index | `id(es)` | a record edited in place kept resolving |
| parser identity | a process-local list | a replaced parser kept the old identity |

The attack is one line long: qualify a coherent chain, then edit the raw capture in place so the getter RAISED. The
warm process still answered `QUALIFIED_CALLABLE`; a cold process answered `UNQUALIFIED`. Two processes reading the same
bytes disagreed, and the wrong one was the one that had already been trusted.

## The v1.7 law

1. **No authority cache may be keyed on identity.** Not `id()`, not a mutable container's address, not a
   process-local flag, not a caller-supplied handle. This is a machine-checked property: `validate_v1_7.py` greps the
   library for identity-keyed cache writes and fails on any.
2. **A cache key is a content digest plus the authority version.** `content_key(caps, rp, es, env, active)` is
   `AUTHORITY_VERSION` together with the content digests of the capability matrix, the read-primitive authority, the
   evidence set, the contract environment and the active authority, plus the identity of the live reference parser and
   the trusted capture shim. Change one byte of any of them and the key changes.
3. **An unserializable input produces no key at all.** `content_digest` returns `None`, `content_key` returns `None`,
   and the caller recomputes. Failing closed to a slower answer is always allowed; failing open to a remembered answer
   never is.
4. **In-place mutation must miss.** A mutated input yields a different content key, so the warm answer is recomputed.
   The property the validator asserts is stronger than "the cache is correct": **warm == cold, always**, for every
   attack in the suite.
5. **Cached values are immutable to callers.** Qualification results are stored as JSON text and re-parsed on return,
   so one caller can never mutate another caller's remembered answer.
6. **Parser identity follows the live code.** `parser_sha256()` is memoized under a content key derived from the
   compiled bytecode, constants and names of every function the parser identity hashes. Replace or patch any of them
   and the key changes, so the identity is recomputed from source. A patched parser can never keep serving the hash of
   code that would no longer run.
7. **There is no record index keyed on the evidence set.** `find_records` re-reads the record map and re-derives
   `record_id` from each candidate's current content on every call. A record edited in place stops resolving
   immediately, and iteration order is by record id, never by map insertion order.
8. **Caching is observable.** `clear_authority_caches()` and `authority_cache_stats()` are
   INTERNAL_NON_AUTHORIZING helpers that exist so a reviewer can prove warm/cold equality and the absence of cache
   pollution. Calling them can never change a result, because every cached value is a pure function of content.

## What is deliberately still cached

The primitive-spec digest (keyed on the content of the probe primitive list), the parser identity (keyed on the live
parser code), the trusted-shim authority (keyed on the bytes of `TRUSTED-SHIM.json` and the shim source), the schema
registry (keyed on the bytes of `SCHEMA-REGISTRY.json` and every schema it pins), the per-method qualification and the
callable set (both keyed on `content_key`). Every one of those keys is a digest of the content that determines the
answer, so the cache is an optimisation of a pure function and nothing else.

## What this does not claim

Caching correctness is proven only against this bundle's own reference implementation. It says nothing about a future
adapter, a concurrent evaluator, or an evaluator in another language. A second implementation must re-derive these
properties for itself; the machine-checked ones here are the specification it has to meet.
