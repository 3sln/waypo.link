// Byte budget of identity documents (docs/spec/identity-portability.md §4, §5.3 and §7 "Size"; organizations §3a.3).
// Dependency-free so that succession.mjs (verifiers), transfer-in.mjs (the producer check), keys.mjs (rotation
// headroom of a moved identity) and federation/directory.mjs share one set of numbers. succession.mjs re-exports them.
/** Most records in `moves`. */
export const MAX_MOVES = 16;
/** Most characters of an identity URI inside a move statement or attestation (`from.identity`, `to.identity`). */
export const MAX_MOVE_URI = 512;
/** Most bytes of a compact move statement and of a compact move attestation (ASCII, so bytes = characters). */
export const MAX_STATEMENT_BYTES = 3072, MAX_ATTESTATION_BYTES = 2560;
/** Budget per signing-key entry, JSON framing per record, and the per-move allowance. */
export const MOVE_KEY_ALLOWANCE = 1792, MOVE_RECORD_FRAMING = 64;
export const MOVE_ALLOWANCE = MAX_STATEMENT_BYTES + MAX_ATTESTATION_BYTES + MOVE_RECORD_FRAMING + MOVE_KEY_ALLOWANCE;
/** The base every moved document gets, which is also the bound of a document without `moves` (organizations §3a.3):
 * both must hold 16 own signing keys (KEY_HISTORY_LIMIT) at MOVE_KEY_ALLOWANCE, the certification keys and the header. */
export const DOCUMENT_BASE_BYTES = 32768, DOCUMENT_BYTES = DOCUMENT_BASE_BYTES, MAX_DOCUMENT_KEYS = 64;
/** 32,768 + 16 x 7,488 = 152,576 bytes. Verifiers refuse a larger document; producers never publish one. */
export const MAX_MOVES_DOCUMENT_BYTES = DOCUMENT_BASE_BYTES + MAX_MOVES * MOVE_ALLOWANCE;
/** A kid in a move statement or attestation header: 1 to 128 printable ASCII characters (§4 "Size"), so the per-record
 * worst cases above hold. */
export const MOVE_KID = /^[\x21-\x7e]{1,128}$/;
