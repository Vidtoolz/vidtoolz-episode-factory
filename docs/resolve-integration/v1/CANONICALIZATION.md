# Canonicalization specification v1 (FROZEN_NOW; Node conformance test = M1 work)

Applies to every hashed payload (`snapshot`, `mutationPlan`, `bindingSet`, journal records, manifests). Validation against the object's schema precedes canonicalization; canonicalization never repairs.

1. **Encoding:** UTF-8, no BOM, no trailing newline. Output bytes are hashed with SHA-256.
2. **Objects:** keys sorted by Unicode code point of the key string (byte order of UTF-8 is equivalent for valid strings); duplicate keys forbidden; no whitespace anywhere (`{"a":1,"b":[1,2]}`).
3. **Absence:** a missing required property fails validation; optional absence is encoded by omitting the key; `null` appears only where the schema explicitly allows null. `undefined` never collapses silently.
4. **Strings:** exact, no trimming, case folding or Unicode normalization. Escape exactly: `"` → `\"`, `\` → `\\`, U+0008 `\b`, U+0009 `\t`, U+000A `\n`, U+000C `\f`, U+000D `\r`, other U+0000–U+001F → `\u00XX` with lowercase hex; every other code point (including `/`, U+007F, U+2028, U+2029, non-BMP) is emitted literally as UTF-8. Lone surrogates are invalid input.
5. **Numbers:** only integers within [−2^53+1, 2^53−1], emitted in decimal without sign for zero, exponent or leading zeros. Non-integer quantities are forbidden as bare numbers and MUST be tagged objects: rational `{"$rational":"p/q"}` with reduced positive q and no spaces; binary64 `{"$f64":"<16 lowercase hex of IEEE-754 big-endian>"}` with negative zero normalized to `0000000000000000`; NaN/Infinity rejected. Frame counts, ms, samples are integers.
6. **Arrays:** order is schema-defined (sorted by declared sort keys where the schema says so; insertion order where order has semantics). Sorting uses code-point comparison on the canonical serialization of the sort-key tuple; equal keys are a validation error unless the schema permits duplicates.
7. **Booleans/null:** `true`, `false`, `null`.
8. **Digest:** `sha256(canonical_bytes)` hex lowercase. Content-addressed ids take a documented prefix length of that hex.

Golden vectors: `fixtures/canonicalization/vectors.json` (input JSON → canonical bytes → sha256), produced by the Python reference in this bundle's generator. M1 MUST add a Node implementation that reproduces every vector byte-for-byte before any hash is used as a guard.
