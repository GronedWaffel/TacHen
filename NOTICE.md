# Credits and licensing

TacHen's coordinator, state/journal, operation queue, failure model, phone deck and
command API are original project work licensed under GPL-3.0-or-later.

The small QuickJS native host and Node-compatible filesystem, socket and HTTP
bindings are adapted from GronedWaffel's PS Neighborhood, GPL-3.0-or-later. Their
import hashes are recorded in `vendor/runtime-provenance.json`. TacHen does not
embed or rename Neighborhood's application interface or workbench.

QuickJS is by Fabrice Bellard and Charlie Gordon, MIT; source and license are in
`vendor/quickjs`. Node-compatible Buffer, readable-stream, events, path-browserify,
abort-controller and noble-hashes retain their package licenses and locked versions.
The build uses esbuild (MIT), Zig, and the PS5 payload SDK v0.43 by John Törnblom
and the PS5-Payload-dev contributors. The SDK is an external GPL dependency.

Future integration of etaHEN, kstuff, ShadowMount, Payload Manager, OnionHEN FPS
work, save tools or other projects must preserve their own notices and source
requirements. Listing an intended integration here does not imply it is finished.

The .plugin container interpretation follows etaHEN/etaHEN-Plugins
`lib/make_plugin.py` (commit 6339554e4e3c92c0a655a37194c1152d6b82ad88), as
documented in our existing GPL etaHEN port. JSON cheat field interpretation follows
etaHEN's public CheatManager implementation. Format parsing and transaction logic
in TacHen are original code; cheat authors' credits are preserved during import.
