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
implemented and cross-built. Native PRX loading and JSON cheat transactions now
use this context. Overlays still need their execution adapters; all three paths
require deferred console acceptance.

The phone and controller Cheats page imports exact-title/version JSON packs,
preserves their credits and offers enable/restore operations. Native execution
stops the verified game instance, checks every expected byte before the first
write, verifies writes and rolls back partial failure before resuming. Durable
intent is saved before stopping the game; uncertain results prevent replay.
The current adapter supports module-relative section-zero patches. Other section
layouts, absolute/code-cave patches and encrypted/XML/BIN formats remain work in
progress. Local tests do not establish real-game compatibility.

## Developer MCP

On the console-hosted phone page, open **Preferences → Developer tools**, enable
the tools, then choose **Create connection**. Configure a Streamable HTTP client
with the displayed `/mcp` endpoint and `Authorization: Bearer …` header. Access
lasts one hour; creating another connection invalidates the previous token.
**Disconnect MCP clients** revokes it immediately. Tokens stay in runtime/browser
memory, are omitted from snapshots and logs, and are not saved in configuration.
This is a direct HTTP connection for a trusted LAN, without a cloud relay.

MCP exposes readiness, imported cheat details, operation status, module lookup,
bounded memory reads and hex/wildcard scanning. A scan targets an explicit module
range, up to 16 MiB, in reads of at most 64 KiB. Each read stops and resumes the
verified game instance; different chunks are not an atomic snapshot. Scans retain
at most 8,192 matches and explicitly report truncation. Results have a five-minute
access window in bounded session RAM; raw memory is not written into job history.
Cancel stops between confirmed reads. Unconfirmed resume retains the operation
for reconciliation instead of permitting a competing memory operation.

The separate **Allow MCP cheat writes** switch authorizes imported, exact-version
cheat transactions. It resets when TacHen starts. The MCP client cannot enable
this switch itself. Revocation is checked again before queued execution and
between scan chunks; a native operation already underway finishes its cleanup.
Arbitrary native code execution and raw unrestricted writes are not MCP tools.

Transport follows the [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports),
using JSON responses and negotiated 2025-06-18 or 2025-03-26 sessions. GET returns
405 because this endpoint does not provide server-initiated SSE. Host/Origin,
bearer authorization, session identity and protocol version are checked. Local
HTTP tests and the embedded QuickJS check pass; console syscalls and third-party
client interoperability still need hardware acceptance. Heap-region enumeration,
unknown-value/differential refinement and broader debugging are not implemented.

The phone's Plugins tab now registers verified etaHEN `.plugin` containers, starts
their embedded ELF as a named plugin process, and supports optional system or exact
game/version autostart. Manual start works before a game opens. Plugin identity is
kept separate from game title identity. Durable receipts bind the actual file hash,
console boot and process generation; PID reuse never counts as the same running
plugin. Process presence is reported separately from plugin feature initialization.
This development stage permits one dispatch per plugin identity per boot; disabling
autostart prevents future automatic launches but does not stop an existing process
or undo its patches. Safe stop/restart and controller plugin
controls remain unfinished. No plugin has been executed on console for this build.

Native `.prx`/`.sprx` modules now have a separate game loader wired to phone
registration, manual start and autostart. Register the exact game title/version;
autostart can be enabled before opening it. The worker rechecks the full file,
container platform, process birth identity and mounted metadata hash, then stages
a read-only copy in that verified sandbox's `/tachen-modules` directory. Private
operation records stay under `/data/tachen/modules`; the game never needs access
to TacHen's state or a global `/data` mount. A checksummed per-game receipt
precedes hook publication and module-slot writes. Successful loading requires both
a valid module handle and a successful initializer result. A failed or interrupted
load is never silently retried in the same game instance.

The game callback supports eight attempts per game instance. A module stays
resident until that game closes; disabling autostart is not a generic unload or
patch-undo operation. Proven game exit settles held work, allowing the next game
instance to receive its configured modules. A missing or ambiguous process census
does not count as exit. The actual callback and trampoline execute in host tests;
native injection, module imports and behavior still require console acceptance.
The manifest records the path as wired, with hardware verification still false.

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
metadata checks, injector and game-input handoff are cross-built only. Final
visual design and console acceptance remain unfinished; all console testing is
deferred.

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
The artifact link regression also requires Python 3 with Capstone 5; `PYTHON`
can select that interpreter. `python scripts/audit-process-links.py` checks all
three built ELFs for calls or relocations into the SDK's obsolete PID cache.
Build the artifacts before running that check. It runs entirely on the host.

Original work lives in `src/`, `ui/` and `tests/`. Reused low-level foundations
must retain source, licensing and provenance. Existing etaHEN, Neighborhood,
ShadowMount and YouTube releases are not modified by this project.

See `docs/IMPLEMENTATION.md` for scope, current evidence and remaining work.

Optional native telemetry now samples PS5 AGC render counters, DCE display
scanout, process CPU time and resident memory. Phone Preferences and the native
ShellUI deck consume the same readings. Metric updates do not invalidate menu
actions. CPU is normalized to total logical CPU capacity; display scanout is
labeled separately, and stale/missing measurements are unavailable. Sampling
does no native work when disabled or without a verified game. PS4 games use a
separate GNM flip-submission counter, installed once per game instance through
the job queue. Its durable receipt prevents automatic reinstallation after an
interrupted or rejected attempt. Sampling checks the live hook and control
cookie before accepting readings. Turning FPS off stops sampling; an installed
PS4 entry counter remains until that game exits. The native renderer uses the
same readings in its Game scene; actual in-game presentation and these native
sampling paths have not been tested on a console.

The game callback also stages a typed post-read controller bridge. It preserves
native read results, records bounded input events, and filters only the
controller identified by a short-lived capture lease. A coordinator relay now
connects those events to the native deck. Holding L3 + R3 requests ownership;
menu actions wait for the capture acknowledgement and a presented frame. Stale
renderer feedback, changed games or interrupted exchanges release ownership.
Host tests exercise the bridge machine code and controller routing. Actual
in-game usability remains unverified on PS5.

Game input preparation now starts independently of PRX loading and shares its
callback ownership, queue exclusions and durable receipt. It requires a verified
game instance, kernel services and a fresh deck renderer. Interrupted attempts
are retained rather than reinjected. An asynchronous native input exchange is
also compiled: it drains published events and writes only the private pad
lease/cursors, with bounded leases and fresh process/page checks. Host tests run
that protocol against the actual bridge machine code. The renderer supervisor
enables capture only for a fresh renderer and observed controller, using the
console's monotonic clock. Extended/device-specific pad APIs need separate
adapters; this implementation handles normal scePadRead/scePadReadState.

The Loadouts tab saves exact-version plugin, cheat and overlay selections.
Review and apply uses the ordinary native job adapters, with all selections
checked before the first dispatch and each step recorded separately. Automatic
loadouts own their selected plugins' autostart and run once per game instance.
Failures stop later steps; already loaded code is not presented as rolled back.
The controller Games section can review/apply the current loadout, toggle its
automatic startup and release its temporary overlay choices. Phone editing and
controller actions share the same checked state. This integration is locally
tested and cross-built; console acceptance remains pending.

Saved games can now be selected from the phone's Saves tab or the controller's
Games → Saved games section. The native helper reads PS4/PS5 save containers,
copies and verifies the encrypted image, mounts only that disposable copy,
then streams decrypted files into a PAX tar archive with per-file checksums.
It confirms unmount before publishing to the FTP share or a selected USB drive.
The installed save is opened read-only. Game-closed checks, exact source/volume
identities and durable operation receipts prevent silent retries after uncertain
outcomes. Catalogs and exports are explicit jobs, not background save scans.
This path is cross-built and locally tested; the PFS calls, filesystem behavior
and real exported saves still need console acceptance. It does not restore or
resign saves. Unknown mount/publication states retain private staging for
inspection and currently require support reconciliation.
