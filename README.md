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

The controller deck's **Games → Packages** screen lists phone-staged packages,
starts background verification, and confirms installation of the displayed
checksum and content identity. Held jobs can be resumed, queued work cancelled,
and interrupted installations checked without resubmission. Running installation
cannot be cancelled here. Native installation is integrated for the exact target
profiles listed above using the historical shared progress fields. Per-firmware
console validation is still pending.

Running-game context now combines a native process-generation/application probe
with bounded reads of that title's mounted sandbox metadata. Two consistent
observations establish its title/version for the phone and console deck. Ambiguous
processes, missing metadata and native contention hold game actions; they never
silently select cached library versions. Lifecycle consumers receive an abort
signal when the verified instance becomes unavailable. This foundation is
implemented and cross-built. Native PRX loading and JSON cheat transactions now
use this context. Native overlay adapters are also implemented; all three paths
require deferred console acceptance.

The phone imports exact-title/version JSON, SHN/XML and MC4 packs;
phone and controller share the same catalog and patch operations. Import
preserves their credits and offers enable/restore operations. Native execution
stops the verified game instance, checks every expected byte before the first
write, verifies writes and rolls back partial failure before resuming. Durable
intent is saved before stopping the game; uncertain results prevent replay.
The current adapter supports module-relative section-zero and explicitly absolute
user-address patches, including mixed-mode overlap checks after module resolution.
Absolute addresses are used as supplied; ASLR correction is never guessed. Unequal
On/Off lengths retain the file's semantics: every supplied expected byte is
checked, and a failed transaction restores captured original bytes. Successful
disable may leave extra On bytes beyond a shorter Off sequence, so these cheats
are marked in both interfaces and do not offer exact history undo. Advanced
section addressing and code-cave relocation are excluded from TacHen's scope;
unsupported entries cannot execute. Input formats are JSON, SHN and MC4.
Local tests do not establish real-game compatibility.

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

`memory_refine` narrows a completed scan by comparing its retained candidates
with their last observed bytes: changed/unchanged, equal/different from a new
hex pattern, or increased/decreased with an explicit little-endian numeric type.
Signed/unsigned integers through 64 bits and 32/64-bit floats are supported;
nonfinite float candidates do not match numeric comparisons. Each pass creates
a new five-minute RAM result and does not alter the previous baseline. A
truncated source stays marked truncated. No candidate bytes enter job history,
and refinement never broadens the scan beyond its retained candidates.

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
initial unknown-value sampling and broader debugging are not implemented.

The phone's Plugins tab now registers verified etaHEN `.plugin` containers, starts
their embedded ELF as a named plugin process, and supports optional system or exact
game/version autostart. Manual start works before a game opens. Plugin identity is
kept separate from game title identity. Durable receipts bind the actual file hash,
console boot and process generation; PID reuse never counts as the same running
plugin. Process presence is reported separately from plugin feature initialization.
This development stage permits one dispatch per plugin identity per boot; disabling
autostart prevents future automatic launches but does not stop an existing process
or undo its patches. Safe generic stop/restart remains unfinished.
Controller Payloads -> Plugins now provides registration, manual loading and
autostart controls through the same commands as the phone. Exact targets can come
from the running game or a saved loadout; arbitrary title/version entry remains
on the phone. Circle returns through the nested views without closing the deck.
No plugin has been executed on console for this build.

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

**Components → Review startup** inspects configured services and unfinished work
without dispatching anything. Confirming the reviewed plan reserves ordered startup;
other native jobs and automatic game workers wait until it settles. The controller
Home page exposes the same review. An uncertain kernel-startup attempt can expire
only after two matching observations establish a different console boot. Package,
save and filesystem operations never expire through this rule. A renderer from a
previous coordinator cannot be adopted with an obsolete private connection.
The known-good preferences are saved only after the complete configured service
set passes readiness again. This is startup evidence, not hardware validation or
proof that every setting or feature is stable. Binary update selection is described
below; its console acceptance remains outstanding.

The coordinator also embeds `build/tachen-deck.elf`, an internal ShellUI module
with controller navigation and a shared phone/console command bridge. It starts
after verified kstuff and requires a fresh render heartbeat before exposing deck
or IP-overlay controls. The internal module is injected by the coordinator; it is
not a separately loadable user payload. Its panel-based navigation, selection details, managed
metadata checks, injector and game-input handoff are implemented and cross-built.
The production layout has a local visual preview; console rendering, controller
behavior and final visual acceptance remain unverified. All console testing is
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
SHA-256. The payload and package inboxes share capacity reservations. On each exact target profile,
verified entries can queue an isolated native installer helper. It hashes the
source again, serves that retained descriptor through a loopback-only HTTP source,
submits once, and records observed transfer progress and complete status. Its
temporary URL supports HEAD and single byte ranges with four bounded clients;
it exposes no directory and stops when the operation ends or its file changes.
Phone disconnects do not cancel it or cause duplicate submissions. The
helper is cross-built and **not hardware tested**. Progress reads the common
state/byte-counter prefix shared by historical etaHEN declarations and the
captured 13.60 layout. Numeric status-tail error details are read only on 13.60;
other profiles use the textual error state and native API return errors.
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
five built ELFs for calls or relocations into the SDK's obsolete PID cache.
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
resign saves. Activity → Check result verifies an interrupted export in a native
background worker. A verified published archive can complete; an abandoned,
unmounted operation with no publication can release its queue reservation while
retaining private staging. Unresolved processes, mounts, mismatched receipts or
changed USB drives stay held. Recovery never repeats the export or unmounts a
save. Private partial archives are retained for inspection, not automatically
republished.

Activity now shares session history between phone and controller. Review a change
before restoring its previous preferences, plugin-autostart choice or saved
loadout. Undo preserves unrelated later choices and refuses conflicting edits;
it never re-enables developer permissions. Verified cheat and game-mount changes
can queue an inverse operation for the original game/service instance. Current
bytes and source identity are checked again, and an uncertain reversal retains
its existing operation rather than being replayed. Loaded plugins, installed
packages and exported files have explicit explanations instead of a pretend
generic undo. This path has local integration coverage; live reversal behavior
still needs console acceptance.

Older terminal transfer, export, package, update and inspection jobs can move out
of the active state into a private receipt archive. The newest 256 jobs,
unresolved work, native launch guards, undo records, referenced child receipts
and each package's latest successful verification stay active. Reusing an
archived request key returns its original result; it never launches it again.
MCP operation-status reads can retrieve archived results by ID. Archive damage
blocks affected submissions rather than forgetting whether work already ran.
The archive uses up to 64 groups with three recovery slots each, created only
as needed, with a 4 MiB limit per slot. Receipt retention is bounded; a full
archive or state containing only protected records still requires resolution.
Archival does not delete exported files or native operation receipts.

Adaptive notices now share verified completions and actionable failures between
the phone and native overlay. Related bursts are grouped, success messages are
shorter and more spaced out during games, and routine scans/preparation stay
quiet. Turning notices off clears the presentation without replaying old events
when re-enabled. Dismissal is shared; detailed results remain in Activity or
Components. The native notice has an independent sequence and local deadline,
so it neither changes controller action tokens nor persists indefinitely when
the coordinator stops responding. The implementation is locally tested and
cross-built; console appearance and interactions still require acceptance.

Support capture is available under Preferences in the phone interface and is off
by default. Enable it before reproducing an issue, then download the JSON report
and share it explicitly. It records coordinator startup, service transitions,
job outcomes and selected native receipt stages while excluding credentials,
paths, uploaded content and raw memory. The latest three captures use separate
checksummed snapshots; startup events and recent events are retained within a
fixed bound. Recording can be disabled without losing the saved evidence.
See [support capture behavior and limits](docs/SUPPORT-CAPTURES.md). Local tests,
the embedded interpreter and a real browser download were verified; console
storage durability and diagnostic coverage on hardware remain acceptance work.

## Staged builds and next-boot recovery

The build now produces `build/tachen.elf` (launcher with an embedded fallback),
`build/tachen-runtime.elf` (direct development runtime) and
`build/tachen-update.tachen` (update package). These artifacts remain hardware
untested. None is a kernel exploit; launch still requires the existing payload
execution environment. The launcher uses the credited ELF loader, validates the
kernel state, hashes the exact private bytes it will dispatch and records an
attempt before spawning. It refuses another launch attempt in the same boot.

After a successful launcher startup establishes a verified fallback, use
**Components → TacHen updates** on the phone to upload a trusted `.tachen` file.
Verification and staging run as a durable job. Choose **Use staged build next
boot** and confirm; the running runtime and hooks stay in place. Load the launcher
again after the next normal console boot and jailbreak. Controller Preferences
offers the same selection/cancellation/previous-build actions. Uploads can be
resumed, and completed uploads can be staged without another transfer.

The native launcher maintains two checksummed selection snapshots and retains
the current and previous executable packages. A trial becomes good only after
the selected process, source fingerprint and boot identity match its receipt,
and the runtime has verified the configured native startup and committed its
configuration. If acknowledgement never arrives, the following boot returns to
the last confirmed build. This does not claim to detect or recover an already
confirmed build's later crash. A manual previous-build selection also waits for
another boot. Cancelling a selection retains files and does not stop anything.

Format 1 updates require backward-compatible state schema 1 and an exact declared
firmware profile. Their checksums establish integrity, **not publisher identity**;
there is no automatic remote updater or signing authority. A corrupt selection
snapshot blocks changes and launch for inspection. Host fault-injection tests now
exercise the actual native I/O implementation, including interrupted commits and
retry durability. They do not replace PS5 disk and cold-boot acceptance.

**Retained packages** lists at most 128 package headers per refresh. Unused builds
can be removed individually after confirmation on the phone or controller. The
native selection lock and current revision protect the verified build, previous
build, pending selection and recorded launch. Unfinished staging blocks removal.
Unreadable packages, uploads, temporary files and selection snapshots are preserved;
this is not a directory sweep. Refresh after removing an entry to expose additional
packages beyond the display limit. Do not claim these builds are release-ready.

The build checks each embedded component and helper at its exported ELF symbol
span, including the launcher's complete fallback package. Content digests in the
generated assembly invalidate cached objects when an included binary changes.
A successful build requires current bytes and a unique file-backed load mapping;
validating the outer ELF alone is not sufficient.


The native command deck now separates a six-section rail, eight action rows and
an in-focus explanation. Wrapped labels preserve UTF-8 boundaries; selected
unavailable actions keep their reason visible. Metrics/notices/IP remain separate
from controller action identities. Circle goes back from nested Home views and
closes only at the Home root (wire version six). Native panels provide the game
dimmer, navigation rail, focused action, selection highlight and separate overlay
backplates. Managed methods are resolved and checked before hooks are published;
unknown panel metadata prevents startup. Console compositing, appearance and
controller behavior still need hardware acceptance.

`node scripts/preview-native-deck.mjs` starts a loopback-only layout preview on
port 8797. It compiles the production C layout and uses example frames with browser
fonts and production panel geometry/colors. It neither connects to a console nor proves PUI
appearance. Close it with Ctrl+C; `--write-only` just writes the preview HTML.

The accent preference is shared by the phone and native deck. Choose mint, amber
or ice from either interface; native focus markers, accent text and the IP display
update together. Attention messages retain their warning color. Theme changes
reuse existing native widgets and do not repeatedly allocate managed objects.


## Local review bundle

After committing the intended source and building, run
`python scripts/package-review.py`. It verifies the clean source fingerprint and
artifact checksums, then creates a ZIP under `build/review` with the launcher,
direct runtime, update package, exact Git source archive, credits and acceptance
instructions. It rereads the ZIP before publishing the local filename. This is
an explicitly unverified development bundle; the command does not connect to a
console, install, deploy or publish a release. Existing archives are retained.
See [the deferred hardware test sequence](docs/HARDWARE-ACCEPTANCE.md).
