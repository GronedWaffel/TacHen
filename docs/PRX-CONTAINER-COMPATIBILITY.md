# PRX container compatibility tester

The reported Beach Menu failure, `Invalid SELF container bounds`, occurs during
file import, before module registration or game injection. The previous JS and
C parsers required the SELF declared size to equal the complete file size.

An existing local etaHEN fps.prx reproduces that rejection: 14,781 physical bytes,
14,640 declared bytes, ten SELF entries. Its container and ELF checks pass when
the unused trailer is excluded. No changes to that binary are needed.

Both parsers now accept trailing bytes outside the declared container. They also
accept a declared size rounded up to the next 16-byte boundary when every segment
is physically present: OpenOrbis create-fself aligns its calculated final size,
but writes individual segment contents at their offsets. The declared image and
the physical file independently bound the segment data and embedded ELF headers.
Truncated segments, program headers supplied only by a trailer, zero/undersized
declared containers and larger unexplained size discrepancies remain rejected.
File copying and hashing retain the complete original file, including trailers.

References:
- https://github.com/ps5-payload-dev/ftpsrv/blob/master/self.h
- https://github.com/OpenOrbis/create-fself/blob/master/pkg/fself/FSELF.go

Regression fixtures are synthetic, cover both native and JS validation, and
exercise inbox copying/checksumming. They do not contain third-party modules.
The original bounds fix used a local module and synthetic fixtures. It was not
a claim of Beach Menu runtime compatibility with every GTA edition/version.

This build includes the confirmed dashboard input-routing fix and menu isolation
changes. Reboot and jailbreak before loading the new resident ELF. Retry adding
the original PRX from Plugins > Add from storage. If import still fails, preserve
the detailed error beneath the heading; size mismatches now report declared and
actual lengths. Prefer inspecting that exact file before another compatibility
change. Do not rename, truncate or rewrite the user's plugin to bypass checks.

## Shared development SELF wrapper (October 9)

The supplied BeachMenu-1.010.prx now reproduces a separate registration bug:
TacHen classified its `0x1d3d154f` SELF magic as PS4, although this is a PS5
development module. Registering against a PS5 game consequently failed target
validation. PS5 FSELF tooling also uses this older magic; wrapper identity alone
does not establish a PS4 target. See the upstream tooling notes:
https://github.com/blackbearreloaded/ps5-native-app-boilerplate/blob/main/docs/PLATFORM_NOTES.md

Both the JS import validator and native staging validator now treat that shared
wrapper as platform-unspecified, matching raw PRX handling. The selected game
establishes the registration platform. The PS5-specific `0xeef51454` wrapper
still identifies PS5. Container bounds, file hashes, exact registered game and
version, current process identity and module initialization results remain
checked. Nothing converts a PS4 plugin into a PS5 plugin or vice versa.

Synthetic tests cover import, registration persistence, both target platforms,
native container validation and dispatch. The private supplied binary is not
redistributed. Passing these checks does not prove its in-game initialization
or features work; the reported game crash remains unattributed without its
module result or fault evidence.

Runtime logs now include registration verification/save outcomes and native
module stage transitions, including loader handle and initializer result.
These concise entries do not require enabling developer diagnostics.

For local build delivery, `.local/build-output.json` may specify a
`desktopDirectory`. After a successful build, that directory receives
`TacHen-latest.elf` (the explicitly bundled runtime launcher) and
`TacHen-latest-build.json` with the source identity and SHA-256.


## Worker and import-hook changes (October 10)

PRX initialization now runs on a game-owned pthread. The controller callback
only schedules it and does not wait for module_start or plugin_load to finish.
One initializer runs at a time. A failed thread creation is reported as not
loaded; a failed or timed-out initializer remains tracked until that game exits.

Where verified executable import metadata is available, TacHen redirects the
game's aligned controller import slots and calls the existing target first.
This preserves existing call chains and avoids rewriting libScePad instructions.
Games without usable imports retain the existing checked export-hook fallback.
Logs identify the chosen path. Pointer publication checks original bytes and
restores partial writes and page protections before resuming the process.

After successful module_start, paired plugin_load/plugin_unload exports select
the optional activation convention. plugin_load runs once with zero arguments.
Modules without that pair retain module_start-only behavior. Initialization,
activation, thread creation and symbol lookup have separate diagnostic results.
A nonzero activation result is a failure even if module_start succeeded. This
is not a GoldHEN syscall-500 implementation and does not certify mod features.

Temporary native contention now preserves the plugin's last process generation.
A verified exit settles an old interrupted operation even if its old receipt
can no longer be read. Unknown live-process outcomes still cannot be replayed.

Host tests execute the actual generated callback on a separate thread with a
blocked initializer, reentrant input, failures and optional activation. They
also exercise the original-first import thunk, malformed runtime metadata,
pointer rollback and loading in a new game instance. The worker's console
initialization result is recorded below. Reboot and jailbreak before loading the
new resident ELF; do not inject it over the earlier resident runtime.

For Beach Menu, test an offline PS5 GTA session matching the supplied module,
then close and reopen the game and load again. Preserve runtime.log and, if
present, /data/gta5.log after a failure. The supplied PS5 module's unchecked
fixed-address patching and its separate data/config requirements remain under
investigation; the staged-copy SDK adaptation below does not modify plugin
instructions or widen game text permissions. PS4 compatibility needs the exact
PS4 module and matching game, not the PS5 Beach sample.

## SDK rejection and executable staging (October 10)

On firmware 13.60, the supplied PS5 Beach Menu was rejected by the raw kernel
module loader with errno 99 (`ESDKVERSION`, exposed as `0x80020063`), before
its initializer. The userland SDK validator accepted the module against the
firmware. GTA's live process parameter declared PS5 SDK 3.00, whereas the PRX
declared 4.00. A map-only comparison isolated the rejection to the moduleparam
PS5 SDK declaration: changing just those four bytes in a disposable copy to
the host SDK allowed mapping and unloading. Changing the SELF extended firmware
field alone did not help, and that experiment is not shipped.

For plaintext development PS5 SELFs with recognized moduleparam metadata, the
loader now prepares a host-SDK copy when the module declares a newer SDK than
the host but not newer than the console firmware. It reads the live process
parameter using the kernel API, without changing game credentials or its SDK.
Only the copied PS5 moduleparam field changes; the original upload, PS4 SDK,
instructions and imports remain intact. Unrecognized/compressed layouts and
retail containers go through the ordinary loader unchanged. This is not an
emulation of APIs absent from the game or firmware. Normal import resolution
and initializer results still determine success. Diagnostics record both SDKs
and original/staged hashes.

Game sandbox roots were also observed to have a 2 MiB tmpfs quota. Modules are
now stored under `/data/tachen/module-files/v1-p<platform>-<host SDK>/` and exposed
through an executable, read-only nullfs mount at the game's `/tachen-modules`.
Backing copies are reused per SDK, not duplicated for every launch. The process
root vnode identifies the current sandbox even if a previous launch left a
similarly named directory. Games whose loader has deliberately given them the
global root retain a unique-active-app0 fallback.

The production storage implementation and production game callback were tested
on the console with the supplied PS5 Beach module: its initializer returned zero
with a valid module handle and GTA remained running. Visual mod behavior and a
complete close/relaunch cycle with the new resident build still need user
confirmation. This does not establish compatibility with PS4 Beach builds,
other game versions, or every supported firmware.

Failed game-module jobs reserve only their own game generation. They no longer
hold the global payload dispatcher and prevent unrelated ELF payloads running.
An uncertain initializer is still never automatically replayed in that process.


## Beach black-screen comparison and manual loading (October 10)

The supplied Beach PRX displayed its own startup notifications and installed its
GTA hook, but GTA stalled during early automatic loading. Three stopped-thread
snapshots showed the game main thread waiting in syscall 703, reached through its
asset-read path; they did not show execution stuck inside Beach's menu hook.
This locates the observed wait, not the underlying cause of the timing interaction.

On the same console and resident TacHen build, the user confirmed GTA started
normally without automatic Beach loading. After Story Mode loaded, manually
loading that same Beach file kept the game running and its menu opened. This is
hardware confirmation of manual loading for that exact PS5 game/module pair,
not general certification of all PRXs or a proven repair of early injection.

At the user's request, plugin autostart is removed rather than replaced with an
arbitrary delay or unproven readiness heuristic. Controller and phone show:
"It's recommended to not start plugins until you are in game." Existing plugin
registrations and loadouts containing plugins migrate to manual loading. Old API
requests cannot reenable automatic plugin loading; manual loadouts remain usable.
No plugin instructions were modified as part of this black-screen investigation.
