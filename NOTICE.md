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

Future integration of etaHEN, OnionHEN FPS
work, save tools or other projects must preserve their own notices and source
requirements. Listing an intended integration here does not imply it is finished.

The .plugin container interpretation follows etaHEN/etaHEN-Plugins
`lib/make_plugin.py` (commit 6339554e4e3c92c0a655a37194c1152d6b82ad88), as
documented in our existing GPL etaHEN port. JSON cheat field interpretation follows
etaHEN's public CheatManager implementation. Format parsing and transaction logic
in TacHen are original code; cheat authors' credits are preserved during import.

Native process creation and remote-call plumbing in `platform/loader` derive from
John Törnblom's libelfldr/libNineS (GPL-3.0-or-later), using the existing etaHEN
port's verified syscall and payload-argument adaptations. Original copyright
headers are retained. Import inputs and hashes are in `vendor/loader-provenance.json`.
TacHen adds original full-image validation/mapping, asynchronous dispatch,
checksummed durable receipts and queue integration in `platform/native` and `src`.
The SHA-256 implementation is Brad Conte's implementation as vendored by ftpsrv,
with the existing port's unsigned-shift correction and original author notice.

The loader's treatment of runtime imports was checked against the SDK v0.43
[payload dynamic linker](https://github.com/ps5-payload-dev/sdk/blob/v0.43/crt/rtld_payload.c):
the payload CRT resolves library/symbol imports. TacHen validates referenced data
and applies relative relocations, leaving runtime symbol resolution to that CRT.

Embedded raw component release files are independently pinned in
`vendor/components.json`: [kstuff-lite 1.11](https://github.com/EchoStretch/kstuff-lite/tree/85fb88a526e58e357d6f1e626ce05af4acdb8b5d)
by EchoStretch and the kstuff contributors, [ShadowMountPlus 1.7beta4](https://github.com/drakmor/ShadowMountPlus/tree/1.7beta4)
by Drakmor and contributors, and [Payload Manager 0.5.2](https://github.com/itsPLK/ps5-payload-manager/tree/v0.5.2)
by PLK and contributors. These are GPL components, not TacHen inventions. The
development build embeds their unmodified upstream ELFs; it does not embed the
older etaHEN-dependent Snipers supervisor wrappers. Corresponding source archives
and licenses must accompany any eventual binary distribution; this project has
not published a binary release.

`platform/native/firmware-profiles.h` preserves the unified GronedWaffel port's
public DATA-relative tables. Immutable source references and values are retained
in `vendor/firmware-provenance.json`. The kstuff marker classifier is adapted from
that GPL port's `port_kstuff_state.hpp`; TacHen adds consistent snapshot checks,
worker serialization and process/API generation checks without modifying hooks.
