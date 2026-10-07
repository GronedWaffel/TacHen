# TacHen

An original PS5 control runtime and contextual command deck, with a console-hosted
phone interface. Development source, **not a completed or hardware-validated HEN**.

The exact firmware targets are 11.00, 11.20, 11.60, 12.00, 12.02, 12.20, 12.40,
12.60, 12.70, 13.00, 13.20, 13.40, 13.42 and 13.60. 11.40 is excluded. A declared
target is not evidence that a native operation has been tested on it.

## Development

`npm test` runs off-console tests. `npm run dev` opens a loopback-only development
server; it does not contact a PS5, load an existing HEN, or emulate successful native
operations. `npm run build` produces local artifacts when the documented toolchain
is available. Console testing is deliberately deferred until the owner returns.

Run `node scripts/prepare-components.mjs` once before building or testing a fresh
checkout. It downloads pinned upstream release ELFs and verifies their exact
sizes and SHA-256 hashes without executing them. An existing file with a wrong
checksum fails rather than silently accepting a newer release.

The current native artifact is `build/tachen-runtime.elf`, a coordinator, local
phone interface on port 8780, native ELF dispatch, and an FTP share on port 2122. The FTP share is
`/data/tachen/share`, isolated from the coordinator's persistent state. Use FTP
user `tachen` or `anonymous` with any password on the trusted LAN. Development
servers bind only to loopback. This is **not** yet a replacement for etaHEN.

Phone uploads accept ELF, etaHEN plugin containers and native PRX/SELF headers,
then stream a SHA-256 verification. Uploading does not execute a payload. Incomplete
uploads retain their offset so a client can resume. Structural validation does not
establish compatibility with a particular game, firmware, or plugin API.

Running-game context now combines a native process-generation/application probe
with bounded reads of that title's mounted sandbox metadata. Two consistent
observations establish its title/version for the phone and console deck. Ambiguous
processes, missing metadata and native contention hold game actions; they never
silently select cached library versions. Lifecycle consumers receive an abort
signal when the verified instance becomes unavailable. This foundation is
implemented and cross-built; native PRX injection, cheats and overlays still need
their execution adapters and deferred console acceptance.

The phone's Plugins tab now registers verified etaHEN `.plugin` containers, starts
their embedded ELF as a named plugin process, and supports optional system or exact
game/version autostart. Manual start works before a game opens. Plugin identity is
kept separate from game title identity. Durable receipts bind the actual file hash,
console boot and process generation; PID reuse never counts as the same running
plugin. Process presence is reported separately from plugin feature initialization.
This development stage permits one dispatch per plugin identity per boot; disabling
autostart prevents future automatic launches but does not stop an existing process
or undo its patches. Safe stop/restart, native PRX loading and controller plugin
controls remain unfinished. No plugin has been executed on console for this build.

On console builds, verified ELF entries offer **Run payload**. A separate native
worker hashes the exact execution buffer, validates memory/relocation bounds and
spawns the payload with the PS5 payload ABI. Checksummed dispatch receipts survive
runtime restarts. **Dispatched** does not mean the payload initialized successfully.
The loader prevents another dispatch of the same payload during a console boot
and never silently retries a failed or interrupted spawn. These native operations
are cross-built but still await hardware acceptance.

Native startup now stages embedded kstuff-lite 1.11, ShadowMountPlus 1.7beta4 and
Payload Manager 0.5.2 through the same durable dispatcher. Readiness requires
kernel hook markers and, for HTTP components, the expected version/API plus a
consistent process instance. The phone remains available throughout startup.
Unknown state blocks another launch. Recovered startup enters recovery mode;
it does not automatically replay interrupted native operations.

The coordinator also embeds `build/tachen-deck.elf`, an internal ShellUI module
with controller navigation and a shared phone/console command bridge. It starts
after verified kstuff and requires a fresh render heartbeat before exposing deck
or IP-overlay controls. The internal module is injected by the coordinator; it is
not a separately loadable user payload. Its initial list presentation, managed
metadata checks and injector are cross-built only. Final visual design and
in-game input arbitration remain unfinished; all console testing is deferred.

Before starting Payload Manager, TacHen backs up its existing configuration and
disables its independent autoload, automatic browser opening, disc-player kill
and automatic dashboard-app installation. User payloads and other settings are
preserved. A self-update folder blocks dispatch of the pinned copy for review.
Already running verified components are adopted without altering configuration.
These adapters are implemented and cross-built; hardware behavior is unverified.

The phone's Games tab reads ShadowMount's cached catalog, searches by name or
title ID, and pages results without including the full library in every status
poll. Mount/unmount operations use a durable queue, respect ShadowMount's active
game guard and independently check the resulting state. Installed packages are
shown alongside image sources but cannot be mounted through image controls.

**Manage files** offers background copy, move, and image-to-folder extraction
through the pinned ShadowMount API. The phone lists writable managed destinations
and actual available space. Activity shows byte progress and cooperative
cancellation; extraction retains the source image. A durable operation receipt
binds the source, destination volume and service instance. Lost or mismatched
receipts never trigger automatic duplicate transfers. Local contract tests pass;
actual console storage behavior remains untested.

The Packages tab can stage complete PS4/PS5 PKGs separately from payloads, up to
1 TiB subject to real free space. Uploads use bounded resumable chunks; checksum
verification runs as a cancellable background job and can check an expected
SHA-256. The payload and package inboxes share capacity reservations. On 13.60,
verified entries can queue an isolated native installer helper. It hashes the
source again, submits once, and records observed transfer progress and complete
status. Phone disconnects do not cancel it or cause duplicate submissions. The
helper is cross-built and **not hardware tested**. Other firmware currently retains
staging only: older installer layouts still need independent ABI evidence.
An API acceptance or a stale playable status is never presented as a successful
new installation. An uncertain result holds the operation and retains its source.

FTP uploads into `/payloads` are copied into the verified inbox after the transfer
has committed. Other FTP files are ordinary transfers. Invalid payloads remain in
the FTP share and generate an actionable entry in Activity. Uploads do not autorun
unless that setting is explicitly enabled; `.plugin` and PRX files are never sent
through the standalone ELF loader.

`node scripts/test-quickjs.mjs` additionally executes portable core code in the
actual embedded JavaScript engine on Windows. `ZIG` and `PS5_PAYLOAD_SDK` can
override the local Zig 0.14.1 and PS5 payload SDK v0.43 paths in build scripts.

Original work lives in `src/`, `ui/` and `tests/`. Reused low-level foundations
must retain source, licensing and provenance. Existing etaHEN, Neighborhood,
ShadowMount and YouTube releases are not modified by this project.

See `docs/IMPLEMENTATION.md` for scope, current evidence and remaining work.
