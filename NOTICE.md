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

Game context discovery uses public application-info definitions from the pinned
ShadowMountPlus 1.7beta4 `include/sm_platform.h` (SHA-256
`4adccbe89265a8b7bac6e6d00a9b873cac4bcacf6f5f04fd2f086386926ac15f`)
and the GPL etaHEN/LightningMods source carried by the GronedWaffel port,
`Source Code/util/source/main.cpp` (SHA-256
`bd227062b1426b3bcc4a30b02695b50e8d6fcb8319391472e3e4ebb04cd57548`).
TacHen validates either evidenced title-field location and refuses unrecognized
responses. The SFO field layout/formats are informed by that port's
`Source Code/util/include/sfo.hpp` (SHA-256
`638f430f8cb4b5df73c6d5116c45b2248b5bd88685fa912ba1de6723f8516afb`).
The bounded metadata parser and lifecycle/lease implementation are original
TacHen code. Source comparisons do not establish console hardware validation.

The native `.plugin` container parser uses the etaHEN-Plugins container layout
credited above. The standalone process convention (plugin ID as process name,
embedded ELF at byte 29) was cross-checked against the GPL GronedWaffel etaHEN
port's `port_plugin_runtime.h` and `daemon/source/game_plugins.cpp` in the local
`compatibility-worktrees/etahen-main-update` source. TacHen implements its own
checksum-bound registry, autostart policy, process-generation receipts and
duplicate/recovery behavior. No universal stop or unload contract is implied by
the etaHEN container format.

TacHen's native game callback trampoline follows the SysV register/FXSAVE
preservation strategy in the GPL etaHEN port's `shellui/include/fps_limiter_stub.h`
(SHA-256 `bfa7ab18cff723a53c5fe916b1edca73c3bffd698d53eb6b90cb2621640b3083`).
Its PRX callback and split-permission arena strategy were checked against
`daemon/source/game-prx.cpp` (SHA-256
`c9f344eb3f962e581408d497dbd066021cf2bcc2959651ffd00b9c3eaf7b54a5`) and
`include/port_game_arena.h` (SHA-256
`68ba28cd469b466b444dac94d280a14a764b6eead48d2b449aa5fe20cf308605`).
The symbol resolver's basename semantics and PID-only process cache were verified
in [ps5-payload-sdk v0.43 kernel.c](https://github.com/ps5-payload-dev/sdk/blob/v0.43/crt/kernel.c),
copyright John Törnblom, GPL-3.0-or-later. TacHen adds a bounded fresh-process-list
comparison in the game injector and replaces the SDK's PID-cached lookup with
an uncached bounded walk in all three console artifacts. The early-CRT fallback
retains the SDK's direct getpid syscall convention, without depending on imports.
The callback control ABI, slot validation and host execution tests are TacHen
code; these checks do not establish PS5 runtime compatibility.

Native PRX/SELF structural validation additionally references the GPL etaHEN
port's `include/port_prx.h` (SHA-256
`3f11d3a1624143095f25c2395ff50cc798808529566f8181bc23bcdfd0bd059b`).
TacHen's complete-buffer validation, immutable staging, checksummed game-instance
receipts, stopped-slot publication/rollback and coordinator recovery are new
implementations. Structural acceptance does not establish compatible imports or
successful execution of a particular third-party module.

The bounded read-only module/VM inspector in `platform/native/memory-map.c`
uses the loaded-object and VM-entry layouts documented by the GPL-3.0-or-later
[SDK v0.43 kernel.h](https://github.com/ps5-payload-dev/sdk/blob/v0.43/crt/kernel.h)
and `kernel.c`, copyright John Törnblom. TacHen adds strict pointer/range checks,
exact basename uniqueness, iteration limits and contiguous-range validation.
These checks do not establish runtime compatibility on an untested firmware.

PS5 telemetry counter layouts and display-query ABI follow OnionHEN /
LightningMods' FPS sources and PHU Games Tools by ArkSama, as carried in the
GronedWaffel etaHEN tree. File hashes and the source revision are recorded in
`vendor/telemetry-provenance.json`. TacHen implements a separate, opt-in point
sampler, guarded fresh page reads, generation/age checks and shared readout;
display scanout is explicitly distinguished from game render counters.
The linked page translator is from GPL-3.0-or-later SDK v0.43
[`kernel_procio.c`](https://github.com/ps5-payload-dev/sdk/blob/v0.43/crt/kernel_procio.c),
copyright John Törnblom, idlesauce and sleirsgoevy. The sampler does not use that
file's generic process-copy fallback or alter process credentials. Its bounded
page-copy loop is original TacHen code. Counter semantics and native operations
still require console validation.

The PS4 counter entry trampoline and GNM export selection derive from the
GPL etaHEN port's `fps_counter_stub.h` and `bc-fps-counter.cpp`, credited to
OnionHEN / LightningMods and the etaHEN contributors. Their hashes are included
in `vendor/telemetry-provenance.json`. TacHen retains readable executable entries
for the indirect jump and adds its own game-instance receipt, control cookie,
publication transaction and ABI execution tests. This counts flip submissions,
not a guarantee of successfully displayed frames.

The normal 120-byte controller sample declarations in `platform/game/pad-bridge.h`
use the independent interoperability research published by
[blackbearreloaded](https://github.com/blackbearreloaded/ps5-native-gamepad-input-research).
Source revision, file hashes and scope are recorded in `vendor/pad-provenance.json`.
TacHen's typed post-read trampoline, capture leases, bounded event queue and
controller ownership/release policy are new code. Relocation continues to use
the credited etaHEN/HDE foundation above. No extended input ABI or hardware
compatibility is implied by this normal-pad reference.

The TacHen update package format, selection journal, next-boot policy and launcher
are original GPL-3.0-or-later code. The launcher links the same credited John
Törnblom ELF loader, SDK and SHA-256 sources already described above; it does not
provide an independent kernel exploit. Build package checksums are not signatures.


The bounded SHN/XML data reader in `src/cheat-xml.mjs` implements the public
Trainer/Cheat/Cheatline format used by etaHEN's `ParseXMLCheat` and the
[GoldHEN Cheat Repository](https://github.com/GoldHEN/GoldHEN_Cheat_Repository/tree/acc22fefac0f0ea35a0f59b3f9526707122098dd).
Format checks examined `shn/CUSA00002_01.00.shn` (Talixme) and
`shn/CUSA00002_01.81.shn` (Celogamez), including the former's retained PKCS#7
padding. Those game patches are not bundled with TacHen. Synthetic regression
fixtures are original. Imported author credits and instructions remain visible;
parsing does not validate a cheat's gameplay effects or make it cross-version.
