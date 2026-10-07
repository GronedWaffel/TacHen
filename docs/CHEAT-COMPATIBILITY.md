# Cheat compatibility evidence

The supported input formats follow the public [GoldHEN cheat documentation](https://github.com/GoldHEN/GoldHEN/blob/master/CHEATMENU.md): JSON, SHN and MC4. File import and native packet validation do not establish game compatibility.

## Pinned sample, October 7, 2026

A local read-only review selected 12 files per format from [GoldHEN_Cheat_Repository at acc22fefac0f0ea35a0f59b3f9526707122098dd](https://github.com/GoldHEN/GoldHEN_Cheat_Repository/tree/acc22fefac0f0ea35a0f59b3f9526707122098dd). Eligible filenames were `CUSA` plus five digits, an exact two-part version, and the format extension. Within each format the filenames were sorted by SHA-256 of their full repository-relative path, and the first 12 were selected. This small deterministic sample is not a claim about the entire repository or PS5 games.

The 36 original files total 153,903 bytes. Local provenance records each source URL, byte size and SHA-256; files and provenance remain under `.local/cheat-corpus` and are not redistributed with TacHen. `node scripts/check-cheat-corpus.mjs <directory>` validates those hashes, imports each pack and compiles both patch directions without contacting a console, writing a registry or applying any patch.

Before the text-handling correction, 28 packs imported and 213 cheats produced both packets. Afterward, 35 packs import, containing 290 cheats; 274 produce both packets and 16 are held for nonzero-section addressing. One JSON pack still fails because two patches have different enabled and disabled byte lengths (28 versus 15). No missing expected bytes were fabricated to admit it.

Seven SHN files exposed two text-conversion cases:

- Four retain an `encoding="utf-16"` declaration despite containing UTF-8 bytes. The import API receives an already-decoded Unicode string; only that stale declaration is normalized.
- Three have a complete repeated padding suffix after `</Trainer>`, but line-ending conversion has changed their former block alignment. A suffix of 1–16 identical padding bytes is accepted only when its value equals its exact length and the preceding text ends in the closing root. Interior controls, incomplete/extra padding, unknown declarations, DTDs and arbitrary trailing content remain rejected.

The fixtures reproduce those structures with original synthetic patch data. Normalization preserves both enable and disable packets exactly. QuickJS exercises the combined stale-label and padding case. Neither correction changes address resolution or the native transaction.

## Remaining compatibility work

Nonzero-section/master-code resolution, missing code caves and unequal patch lengths need explicit execution/rollback semantics. They remain unsupported, not silently approximated. Absolute user-address and section-zero module-relative patches retain mapping, overlap and expected-byte checks. Every accepted pack still requires its exact title/version and final console acceptance. This review did not contact the PS5.
