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

Package CNT/FIH field interpretation in `src/package-format.mjs` is adapted from
GronedWaffel's GPL PS Neighborhood `src/packages.mjs` (source input SHA-256
`0e55bda6d53a33c5651bce1d0deb1c08556452ef844c6b98c0c9d18feb781622`).
That inspector credits flatz's `ps4_remote_pkg_installer/pkg.h` for the PS4 header
layout. TacHen adds its own bounded reader, shared reservations, background
verification and phone workflow; these do not establish signature or license validity.

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

Native deck PUI discovery is informed by etaHEN / LightningMods' `overlay-ui.cpp`
and `MonoUtils.cpp`. Resident thread staging and stopped-thread publication derive
from John Törnblom's libNineS and the GronedWaffel controller-stability work.
TacHen's renderer, controller state machine, private bridge, generation checks and
presentation/command adapter are new GPL-3.0-or-later code. They do not embed
etaHEN's Toolbox pages, dashboard card installer or Boot hook.

The conservative instruction relocator in `vendor/deck` comes from the same GPL
port. HDE64 is by Vyacheslav Patkov (2008–2009); its BSD redistribution notice is
retained in `vendor/deck/HDE64-LICENSE.txt`, from the upstream
[MinHook license collection](https://github.com/TsudaKageyu/minhook/blob/master/LICENSE.txt).
Input hashes and import adaptations are recorded in `vendor/deck-provenance.json`.
The opaque Mono declarations were checked against the public
[Mono object API](https://github.com/mono/mono/blob/main/mono/metadata/object.h).
These references document interfaces and provenance; they do not establish the
PS5 firmware-specific managed signatures or hardware compatibility.

The isolated package helper uses the GPL PS Neighborhood installer ABI and service
contract from `receiver-ps5/install-abi.h` (SHA-256
`26e42938f274ac5b3e498dd08959f234b701c713b27f9ae64cd859681b4039a3`) and
`receiver-ps5/services.h` (SHA-256
`6582c6bbe030ef9a22d330d4ce21123b51c99b9ed61f46f0c87dfd22f6955c5d`),
at GronedWaffel/ps-neighborhood source commit
`29e3e8e331aaa021555ea15bcbe571960727767b`.
TacHen adds its own isolated lifetime, preflight hashing, checksummed durable
receipts, duplicate guards, status tracker and coordinator integration. The
package parser shares the CNT/FIH provenance recorded above. Original upstream
credit and license obligations continue to apply; no new firmware ABI is claimed.
