# Implementation and acceptance ledger

The goal includes every requirement below. Entries remain incomplete until their
actual integration is implemented; a frontend, mock or interface alone does not
count as a native feature. Hardware testing is deferred by owner instruction.

## Required implementation

- Original contextual command deck, controller navigation and in-game presentation.
- Console-hosted phone access with shared state, direct LAN operation and no PC
  companion or mandatory external service.
- Own startup and service coordination after an existing compatible jailbreak;
  exact firmware checks, dependency readiness and duplicate/conflict handling.
- Built-in ELF payload loader, FTP server and FTP payload inbox.
- Background PKG transfer/install queue with actual completion reconciliation.
- ShadowMount, kstuff and Payload Manager integration; no duplicate installations.
- System/game .plugin and compatible .prx/.sprx modules, lifecycle and dependencies.
- PS4/PS5 FPS and resource information, adaptive overlay and bottom-right IP toggle.
- Game identity/version, compatible etaHEN/GoldHEN cheat import and guarded writes.
- Saves: extraction/decryption, computer transfer and USB export; protect originals.
- Optional developer MCP scanning, explicit memory write gate, no idle scans.
- Game loadouts, actionable failure explanations and session change history with
  supported undo; explicitly distinguish unload from disarming a resident module.
- Developer/support diagnostics, user-requested report capture and bounded logs.
- Known-good configuration, safe startup and compatible staged update/rollback.

Kernel panic interception is excluded. Unproven universal FPS limiters, universal
PRX compatibility, native crash isolation and uninterrupted operation after reboot
are not promised. Additional features must earn their cost in usability/stability.

## Architecture decisions

The original coordinator owns shared state. UI, phone and future MCP surfaces
submit commands through it; they cannot separately infer that a native component
is ready. Native adapters must return verifiable readiness/completion evidence.
An accepted install or sent ELF is not proof of execution or readiness.

Persist an intent before a side effect. After interruption, classify the outcome
as unknown and reconcile it rather than replaying it. A timed-out task retains its
resource exclusion until execution settles; timeout cannot authorize a competing
write. Unsupported features return explicit unavailability, never synthetic success.

Settings and user files use `/data/tachen`, distinct from existing released HEN
configuration. No existing project files are renamed or deleted. No deployment,
console load, reboot or hardware test is part of unattended local verification.

## Evidence

2026-10-07: first implementation checkpoint. All 43 Node regression/integration
tests pass. The separate QuickJS executable test passes state persistence,
preferences, SHA-256 and ELF parsing with the same embedded engine. The PS5
cross-build produces `build/tachen-runtime.elf` (1,263,192 bytes at this checkpoint)
and a checksum manifest. No code was sent to the console.

Implemented and locally exercised:

- Serialized, checksummed, alternating persistent snapshots, stale revision
  protection, corruption recovery and failed-write handling.
- Dependency graph, readiness verification, duplicate/conflict prevention, late
  acknowledgement rejection, dependency invalidation and optional safe startup.
- Durable job intent, keyed idempotency, resource exclusions, timeout quarantine,
  interrupted-job reconciliation, held queues after restart, acknowledged cancellation.
- Direct phone API with shared preferences, bounded LAN sessions, Origin/Host and
  CSRF checks, device disconnect; responsive phone/desktop deck inspected visually.
- Payload inbox: bounded chunk upload, durable offset recovery, streamed digest,
  ELF/.plugin/PRX structural validation and rejection of malformed uploads.
- Built-in rooted FTP share: real client upload/list/download/rename tests and
  path containment. Does not yet expose general console/USB roots or feed the loader.
- Portable exact-version loadout planning and JSON cheat parser/transaction engine.
  Memory tests use a controlled adapter and verify comparison, rollback and resume
  behavior. Neither module is yet connected to PS5 game discovery/memory APIs.

## Next implementation work (goal remains active)

1. Complete phone upload resumption controls and library storage adapters for
   console and USB, extending the development share's limited scope.
2. Service-specific readiness probes over the native dispatch adapter. Preserve
   controller-startup fixes in later ShellUI integration. Spawn receipts are not
   readiness evidence and do not verify that a PID still belongs to a resident service.
3. Native kstuff/ShadowMount/Payload Manager adapters, actual job completion
   receipts, process/game lifecycle, package queue and storage reconciliation.
4. Native original command-deck presentation/controller arbitration (the phone
   webpage alone does not satisfy the console UI requirement), FPS/resource/IP UI.
5. Plugin lifecycle, native cheat/session-history/loadout integration and saves.
6. Optional MCP, support diagnostics, known-good configuration promotion and staged
   update recovery. Preserve complete scope above; unavailable capabilities must not
   be advertised as implemented by adding dummy adapters.

Hardware acceptance remains outstanding for every new TacHen integration,
including firmware profiles whose upstream components previously worked. The
user is AFK; all console loads, reboots and hardware testing remain deferred.

## Current local paths and dependencies

TacHen is its own local Git repository at `../tachen`; it has no public remote.
Existing released repositories are unchanged. Build inputs come from sibling
`../ps-neighbourhood/tools/` unless environment overrides are set. Runtime sources
are vendored with original hashes; the import script uses the existing
`../compatibility-worktrees/ps-neighborhood/local-ps5` only when explicitly re-run.
It regenerates adapted platform plumbing, so keep adaptations in that script too.
The native payload engine is 48 MiB capped, uses bounded chunks and a 10 ms event
loop. No PC companion, VPS, DNS change or production deployment is required.

## Second implementation checkpoint: native dispatch and FTP inbox

2026-10-07: 58 off-console tests pass, including the actual native C ELF validator
compiled and executed on Windows. The separate QuickJS test also passes. The
latest cross-build is recorded in `build/manifest.json`; its completion/hardware
flags remain false. The payload page was inspected at a 390×844 phone viewport.

- Added a native pthread dispatch worker, exact firmware guard, private execution
  buffer with independent SHA-256, bounded image validation and PS5 payload ABI
  spawning. The native worker, ptrace calls and process creation are **cross-built
  only**; they have not been executed on the console.
- Added atomic checksummed dispatch receipts, boot-bound duplicate protection and
  explicit unknown outcomes. Native progress is polled without blocking the phone
  event loop. A deadline does not release a still-running native operation.
- Corrected virtual-origin mapping, checked relative relocation destinations,
  supported stripped dynamic relocation tables and shared-page permission unions.
  SDK CRT library/symbol imports are validated and left to its runtime resolver.
  The current TacHen ELF and existing etaHEN/card-installer artifacts pass native
  structural inspection locally; this says nothing about hardware execution.
- Preserved John Törnblom loader credits, syscall-gate adaptations and import hashes.
  Removed obsolete shallow image mapping/network reader paths, widened and filled
  remote-call arguments, and replaced the racing child exec event registration
  with a waitable trace-stop check that preserves child stack ownership.
- Added phone Run controls for verified ELFs and honest Dispatched status. Plugins
  remain excluded from standalone dispatch until their actual loader is integrated.
- Completed FTP-to-inbox import with actual FTP client tests. Complete `/payloads`
  uploads are verified; invalid sources stay in the share with an Activity message.
  Autorun is opt-in and only applies to ELFs through the same durable queue.
- Fixed queued cancellation racing a durable dispatch claim; a dedicated race
  regression test verifies it cannot mark executing native work cancelled.

Pending loader acceptance: console worker/receipt I/O, SDK ABI process spawning,
native failures/timeouts/restart reconciliation, memory pressure with large ELFs,
per-firmware process entry compatibility and service readiness probes. Console
hardware testing remains deferred by the user's instruction.

## Third implementation checkpoint: verified native startup

2026-10-07: 75 off-console tests pass and the embedded QuickJS core test passes.
The native runtime cross-build includes pinned raw kstuff-lite 1.11,
ShadowMountPlus 1.7beta4 and Payload Manager 0.5.2. All three raw ELFs also pass
the actual native full-image validator on Windows. None has been executed by
TacHen on a PS5. Native syscall/process/configuration behavior is **cross-built
only**, and all prior hardware acceptance requirements remain open.

- Native process inspection uses SDK layout assertions, bounded sysctl records,
  boot/PID/start-time generation and no exported kernel addresses.
- Consistent kernel snapshots classify complete, unmodified and unknown kstuff
  hooks. Dispatch rejects transitional or legacy poisoned tables. Kernel-copy
  probes and the dispatch worker do not use the SDK primitive concurrently.
- Services require actual pinned API/version responses and unchanged process
  identity. Component extraction streams bounded chunks and resumes partial files;
  every reuse rechecks its SHA-256. Generic dispatch cannot bypass managed startup
  for these same bundled bytes.
- Startup records intent, adopts verified residents, starts dependencies in order
  and keeps the phone responsive. Missing readiness retains resource exclusion;
  no second copy is automatically sent after an uncertain spawn. Recovery skips
  automatic native work. Periodic observation invalidates lost dependencies after
  two failed checks and never replaces resident processes automatically.
- Payload Manager preparation preserves a durable original-config backup and
  prevents competing autoload/browser/disc-player/app-install actions. Potential
  upstream self-update folders are preserved and block pinned startup for review.
- Local integration fixtures cover component startup/adoption, changed process
  generation, wrong HTTP identity, busy ports, timeouts, corruption and recovery.
  These fixtures establish coordinator behavior, **not** console compatibility.

Remaining major native work: original controller/in-game deck, ShadowMount library
actions and storage jobs, PKG installation, plugin/game/cheat/save adapters,
FPS/resource/IP presentation, MCP, loadouts and update/recovery user flows. A
running component is not completion of every feature built on top of it.

The same checkpoint now includes a phone Games tab and real ShadowMount cached
catalog/mount adapters. **82 local tests pass.** Reviewing the exact beta4 request
dispatcher caught its POST-only JSON contract (including version queries); the
transport and readiness fixture were corrected before any console use. Tests use
real loopback HTTP connections with that contract, check source identity changes,
active-game busy responses, mount observation, pagination and repeated request
identities. Requests bind their original durable intent on retry, even if a
successful first operation changed the state used during validation. The phone
layout was checked at 390×844 with no horizontal document overflow. Kernel/process
and mount behavior still await hardware tests; storage conversion jobs remain open.

## Fourth implementation checkpoint: native deck and controller bridge

2026-10-07: The build now produces and embeds an original `tachen-deck.elf` resident
module alongside the coordinator. **94 local tests pass**, and the real embedded
QuickJS test additionally exercises the controller wire format. Neither ELF has
been loaded on the PS5. No console connection or hardware test was performed.

- Added native PUI labels, scene tracking, pinned managed-object handles, removal
  of replaced scene widgets and controller navigation. The initial presentation
  is a text/card list scaffold; visual polish, backgrounds and actual television
  layout remain open. It is not the final designed command deck.
- Mono entry points, method signatures, button-enum backing type, all controller
  field offsets, return size/alignment, font and color metadata are checked before
  hooks are prepared. An unfamiliar ABI fails closed. Metadata checks themselves
  are cross-built only and still need firmware acceptance.
- Added an injected-thread bootstrap and two-hook publication transaction. It
  rechecks ShellUI generation after attaching, stops threads, checks instruction
  pointers, verifies original bytes, writes through the VM/ptrace path, restores
  per-page protections and attempts rollback before resume on failure. ShellUI's
  process-wide credentials are never temporarily replaced. SDK remote arguments
  now check every write before invoking the module.
- Durable injection intent, boot/process identity and single-attempt guards
  prevent automatic reinjection of an uncertain resident module. The worker
  shares native-operation exclusion with ordinary payload dispatch. A fresh PUI
  render heartbeat is required before console-deck/IP capabilities are enabled.
- Added a fixed-size, validated UTF-8 frame protocol and private loopback bridge.
  Its per-session credential is never in browser state. Controller and phone use
  the same runtime commands, durable queue and optimistic settings revisions.
- Payload/mount actions require confirmation. Controller requests have bounded
  deduplication, immutable source bindings and stale-selection rejection. The
  controller will not activate a newly received row until it was rendered.
  Input callbacks do no file/network work; stale connections release the deck.
- Actual C tests cover wire decoding, multiple controllers, hold/repeat/debounce,
  display acknowledgement, stale release and publication rollback/error cases.
  Publication callbacks are simulated; **PS5 ptrace and VM behavior is untested**.

Outstanding within this deck: final original visual design; in-game controller
arbitration (ShellUI input alone cannot consume a game's pad events); scene and
resolution behavior; resource/FPS overlay wiring; accessibility and shortcut
preferences. Remaining overall features still include package/storage jobs,
native plugin/cheat/save adapters, developer MCP, loadouts and staged updates.
The imported ptrace helpers also retain blocking stop/step waits; bounded wait
recovery needs review before hardware acceptance. The full goal is not complete.

## Fifth implementation checkpoint: bounded trace waits and storage jobs

2026-10-07: **103 local tests pass**. The runtime cross-build succeeds, and the
actual embedded QuickJS checks pass. Nothing was sent to or read from the PS5.

- Replaced imported blocking attach/step and child-breakpoint waits with finite
  polling. The pure C wait classifier rejects unexpected stops, exit, errors,
  backwards clocks and frozen clocks. Entire stepped remote calls also have
  step/time bounds; breakpoint calls retain bounded stop-and-register recovery.
  The owned child's breakpoint must match its expected instruction pointer.
  Unknown rfork-child stack ownership retains the allocation rather than freeing
  memory the child may still be using. These changes do not prove that the SDK's
  kernel APIs or ptrace recovery are correct on hardware.
- Connected ShadowMount's real POST/202 background copy, move and unpack API.
  Destinations come from its mounted writable storage list. Input binds the game
  source/content, destination volume and service generation before execution.
  Large operations use upstream capacity checks rather than arbitrary multipliers.
  Extraction explicitly retains the original image; direct deletion is not exposed.
- Added a private durable job checkpoint for the returned remote operation ID.
  Polls validate that ID, operation, source, destination and process instance.
  A lost acknowledgement, mismatched receipt or service restart remains unknown
  and retains resource exclusion; another transfer is never guessed or replayed.
  Completed means the identified upstream worker reported completion, not an
  independently performed checksum of every copied game file.
- Cancellation is cooperative and confirmed through the same operation status.
  A finalization/cancel race keeps observing the existing job. Native failures
  that may have left data at either location retain an actionable interrupted
  result. The queue has a 48-hour deadline; its expiry never proves cancellation.
- Added phone destination/action selection, source-retention/move explanations,
  available capacity, Activity progress and cancellation. Repeated submissions
  reuse their original request ID after a lost response. Local browser layout
  checked at a 390-pixel viewport (375-pixel content width with scrollbar), with
  no horizontal overflow. Browser fixture uses no console APIs.

Storage tests use real loopback HTTP with the pinned API contract and simulated
worker state. They cover large sizes, HTTP 202, destination replacement, extraction,
request deduplication, cooperative cancellation, missing/foreign receipts and
reconciliation. **Console storage behavior still requires hardware acceptance.**

Next integrations remain background PKG delivery/installation, native plugin,
cheat and save adapters, in-game deck/input arbitration, FPS/resource telemetry,
developer MCP, loadouts and staged update recovery. Final deck design and full
feature acceptance are still outstanding. The overall goal remains active.

## Sixth implementation checkpoint: large package transfer and verification

2026-10-07: Added a dedicated private package inbox and phone Packages tab. This
advances the requested background installer; **it does not yet implement native
package submission**. No PS5 connection, service call or console test occurred.

- Package uploads accept complete `.pkg` files from 8 KiB to 1 TiB, constrained by
  actual free space. Package and payload reservations serialize through one shared
  accounting group so they cannot independently reserve the same remaining space.
  Metadata/initial files are synced, each received chunk is synced, and console
  rename publication also syncs the containing directory.
- The inspector handles PS4 CNT and PS5 CNT/finalized-image headers with bounded
  reads and 64-bit offsets. Tests include a synthetic finalized-image header at
  an offset above 4 GiB and a 180 GiB declared size in the actual QuickJS engine;
  no huge test file was allocated. Bounds/identities are checked before promotion.
- Verification streams SHA-256 using a bounded buffer, yields periodically to
  the coordinator, reports byte progress and preserves uploaded bytes on cancel.
  Optional expected hashes detect disagreement. Header validity and a local hash
  are not proof of package signatures, compatibility or console installation.
- Phone uploads can stop and resume from the committed offset after reselecting
  the exact original file. Name/size matching is only a convenience check; without
  an expected full-file hash it does not prove that a reselected file has identical
  content. The console installer must still validate the final package.
- The real browser upload path was exercised against the loopback development
  server using a synthetic 8 KiB header fixture. It reached a completed verification
  job and explicitly reported that installation had not started. Activity was
  adjusted to keep progress/readable text stacked on a 390-pixel phone viewport,
  with no horizontal overflow. Native console APIs were absent from this test.

Installer investigation: Neighborhood's `receiver-ps5/install-abi.h` records the
13.60 status structure as 712 bytes with its error at offset 0xa0. Older public
etaHEN definitions place that error at 0x3c. Neighborhood therefore deliberately
gates native submission to 13.60. Reusing either definition across all TacHen
targets without ABI evidence would recreate the prior out-of-bounds failure.
Next work is a serialized native installer with durable receipts, progress and
source lifetime, plus explicit ABI checks/adaptation for the other target firmware.
The complete package requirement and all other previously open integrations remain
in scope; no replacement-HEN or hardware-completion claim is made.

## Seventh implementation checkpoint: isolated package installer

2026-10-07: **123 local tests pass**. An embedded native package helper and the
phone's Install package action are integrated for the evidenced **13.60 ABI only**.
This is source/build completion for that adapter, not hardware acceptance or
completion of the full cross-firmware package requirement. No console was contacted.

- A dedicated helper process owns Sony installer calls, temporary credentials,
  retained marshaller arguments and package file handle. Every installer call has
  a 12-second process watchdog. A stalled call can end the helper without ending
  the phone/deck coordinator. This cannot intercept or recover a kernel failure.
- Parent dispatch uses the existing guarded native loader. Only the brief spawn
  owns its SDK exclusion; the long checksum/install work does not hold the
  coordinator's native-operation guard. Child exit is reaped without blocking.
- The helper validates boot identity, request checksum, package/header bounds,
  exact content/type/platform/patch fields, full SHA-256 and file identity before
  submitting. A private flock prevents simultaneous helper ownership. Durable
  launch/submission intent precedes effects, and accepted requests are never
  automatically replayed after a disconnect, interrupted process or reboot.
- Receipts bind request, upload, hash, content and console boot. Status is observed
  with the appropriate base/patch API. An existing incomplete same-content install
  blocks a new submission. Completion requires accepted identity, observed changed
  partial transfer, and two complete status samples; PS4 totals must match input
  package length. A playable initial chunk alone is not completion.
- This deliberately conservative proof can leave a very fast install uncertain
  if all transfer finished before the first status sample, or if the service does
  not expose byte progress. The phone explains uncertainty, retains the source,
  and never retries blindly. A better installer task identity/receipt would allow
  those cases to be established without weakening the stale-base guard. It remains
  part of final installer refinement and hardware acceptance.
- Phone installation jobs survive browser disconnection. Missing/stale/foreign
  receipts retain resource exclusion; reconciliation can adopt a later confirmed
  completion without relaunching. Active native installation is not cancellable
  in this checkpoint. Upload and verification cancellation remain separate.
- Native C tests execute actual parser/request/tracker code on Windows, including
  large-offset and integer-overflow fixtures. Coordinator tests cover native
  acceptance vs completion, preflight rejection, changed receipts, lost heartbeat,
  duplicate requests and late reconciliation. Mock adapter tests do not establish
  the console API's behavior. All three ELFs cross-build; the embedded QuickJS
  portable smoke check passes. The standalone helper is an internal component,
  not a user payload or independently usable installer.

Still required: source-backed adaptation of older firmware installer ABIs,
actual console installation/fast-completion/restart acceptance, and remaining
native plugin, cheat/save, in-game input/rendering, telemetry, MCP, loadout and
update integrations. The overall goal remains active and hardware tests deferred.

## Eighth implementation checkpoint: running-game identity and lifecycle

2026-10-07: **133 local tests pass**. Native application probing, mounted metadata
reading and a shared game lifecycle are wired into the coordinator. The phone and
native deck show the same verified title/version context. No PS5 was contacted.

- Application identity comes from `sceKernelGetAppInfo`, correlated to the
  sysctl process generation. The two inspected public 96-byte definitions put
  title IDs at 0x10 (ShadowMount) and 0x14 (etaHEN). A pure native decoder accepts
  exactly one valid title from these evidenced positions; it does not scan for
  guessed new offsets or accept system title IDs.
- Candidates are grouped by title/application ID. A unique `eboot.bin` is
  preferred within that application; a sole candidate can provide context.
  Multiple unrelated applications or ambiguous main processes remain unverified.
  This context does not by itself authorize injection: module/entrypoint and
  exact instance checks remain required in each forthcoming native adapter.
- Metadata reads use exactly one matching `/mnt/sandbox/<title>_<index>/app0`
  tree. Directory traversal refuses symlinks, file reads are bounded to 1 MiB,
  and process generation/file identity are checked before and after the read.
  Multiple matching sandbox roots are rejected rather than choosing an arbitrary
  higher index. Compatibility with each actual mount layout still needs hardware
  acceptance; there is no fallback that treats cached appmeta as a running version.
- PS5 JSON uses exact `titleId`/`contentVersion`; PS4 SFO uses `TITLE_ID`/`APP_VER`,
  not a numeric maximum with the base `VERSION`. SFO table/key/value bounds,
  overlapping ranges, duplicate fields and invalid UTF-8 are rejected. MOUU
  titles are included consistently in context, cheat identity and profile guards.
- Two consistent snapshots publish a game instance. Ambiguity, contention or
  identity changes immediately withhold game actions and abort the old consumer
  lease. Unknown state is distinguished from observed absence; temporary native
  work does not invent an exit/relaunch. Subscribers cannot block the poll loop
  by awaiting long work, and subscriber exceptions are contained in bounded
  support-only runtime errors. Polls are two seconds active, five seconds idle.

Validation improvements discovered during this checkpoint:

- Zig's optimized C compilation disabled standard `assert` checks in the kstuff
  and new package test runners. Earlier passing runner exits did not establish
  those assertion bodies. All three affected runners now use unconditional CHECK
  guards and each harness proves a deliberate failing check exits nonzero. The
  actual kstuff classifiers and package tracker/request checks now execute and pass.
- The actual QuickJS smoke run exposed `abort-controller` resolving to a browser
  passthrough export, which assumed window/self. Runtime globals now explicitly
  import the library implementation. The smoke fixture loads the actual runtime
  globals and executes game lifecycle/abort behavior, in addition to prior core
  checks, without providing native console APIs.

Remaining work still includes native plugin/cheat/save execution, in-game input
arbitration and rendering, FPS/resource telemetry, MCP scanning, applied loadouts,
staged update recovery, older-firmware installer adaptation, and hardware acceptance
for all new native paths. The full goal remains active.

## Ninth implementation checkpoint: standalone plugin processes

2026-10-07: **144 local tests pass**, plus the actual QuickJS coordinator smoke
checks. The native runtime cross-build is 8,437,192 bytes, SHA-256
`7e97721645ad15de5f12f0b3f43829b0faa6801822b328d8b77de916390eca78`.
The resident deck and isolated package helper are unchanged. No console access,
payload execution, deployment or publication was performed.

- `.plugin` is handled as its real 29-byte etaHEN container. The native worker
  hashes the entire private container buffer, validates its embedded executable
  ELF and dispatches only the embedded bytes with the plugin's own process name.
  Plugin ID/version are not misinterpreted as game title/version. PRX/SELF modules
  cannot enter this daemon loader; their in-game module injection is separate work.
- Registration is durable, bounded to 64 unique plugin identities/hashes, and
  checksummed with the coordinator state. Autostart is off initially. Users may
  manually start a watcher before opening a game, or arm system startup/exact
  game-title-and-version startup. Game targeting controls launch scheduling; it
  cannot constrain arbitrary third-party plugin code once that process runs.
- Launch acceptance and execution reverify bytes/configuration. Safe startup,
  unverified native hooks, changed configuration and changing game context hold
  startup. Automatic attempts are not silently repeated after an unresolved result.
  Disabling autostart also prevents an accepted but not-yet-dispatched automatic
  launch after native worker contention clears.
- The native loader refuses a live owner of the plugin process name and duplicate
  same-boot plugin identities even when a different version has a different hash.
  A dispatch receipt captures the observed PID and process start generation.
  Monitoring distinguishes process present, exited and unavailable census. Process
  presence does not assert successful plugin initialization or active game patches.
- Checksummed version-2 receipts remain able to read original ELF-only version-1
  receipts. Corruption, truncation and unexplained prior state remain held. Native
  duplicate policy and old/new receipt decoding execute in a host C test runner
  with unconditional checks. The shared loader now claims the native operation
  before saving a queued receipt: a BUSY return cannot strand a saved queue intent.
- Phone registration, game-target fields and autostart toggling were exercised
  against a localhost-only fixture using the actual coordinator API. At a 390-pixel
  viewport, the form/card fit without horizontal overflow and emitted no browser
  errors. The fixture never invokes PS5 native APIs and is not hardware evidence.
- QuickJS smoke coverage includes plugin registration, configuration serialization
  and a simulated receipt adapter, using actual runtime globals. Native C tests
  validate real container parsing, embedded ELF bounds, malformed headers, receipt
  checksums/migration, and duplicate rules. Job tests cover PID reuse, game exit
  during verification, cancellation of autostart before dispatch, safe startup,
  changed bytes, duplicate requests and uncertain native results.

Remaining plugin work: safe process stop/restart with explicit effects semantics,
native `.prx`/`.sprx` injection into exact compatible game instances, shared game
callback/input ownership, and controller-side plugin management. This checkpoint
deliberately does not advertise a universal unload ABI or treat killing a plugin
process as undoing patches. The other outstanding native cheat/save, overlay/FPS,
MCP, loadout, update and older-firmware package integrations remain in scope.

## Tenth implementation checkpoint: game callback and injector

2026-10-07: **146 local tests pass**, including execution of the actual x86-64
freestanding game callback and relocated entry stub on the Windows host with
SysV calling conventions. Console module loading is not simulated as hardware
success. The runtime cross-build is 8,454,976 bytes, SHA-256
`b07bcd3816946cf9a9fb15970068ccb59490f3fdebf57ada656a167f02ab2a97`.
No PS5 connection or native console testing was performed.

- The new callback is 816 bytes, SHA-256
  `c82184e5b2a30e4709f34d2d6e8a910e735553682361f2a0db08480c1ea3800e`.
  Its control block has an exact version/size and ownership cookie. Eight bounded
  module slots publish disabled-to-enabled; atomic state transitions prevent
  duplicate or recursive module initialization. Each callback starts at most one
  module. Paths must refer to a hash-named private `.prx` or `.sprx` staging file.
  The callback itself does no filesystem scan, allocation, logging or sleeping.
- Module loading calls the game's actual `sceKernelLoadStartModule` export from
  its input thread. Both returned handle and initializer result are retained:
  a module with a handle but a failed initializer is not assumed unloaded, and
  neither success nor failure gets replayed on subsequent input callbacks.
- The entry trampoline saves original argument registers, flags, floating-point
  state and stack arguments before calling the helper, then restores state and
  executes relocated original instructions. Host tests execute the actual binary
  and stub, verify original integer arguments/results, test nested callbacks,
  disabled slots, incorrect cookies, invalid paths and sticky initialization
  failures. A fixture path-length error was caught and corrected during testing.
- Native injection resolves mapped exports by module basename and NID, checks
  process identity while stopped, stages private code/control memory, and uses
  real target `mprotect` to split RX code from RW control pages. Entry patches use
  stopped-thread publication, PT_IO writes, permission restoration and readback.
  Existing hooks/forwarders are rejected. Failed or uncertain rollback retains
  potentially referenced code rather than unmapping a live branch target.
- The shared publication engine now supports one or two entries; regression
  checks still cover rollback, partial writes, busy instruction pointers and
  uncertain detach. The new injector is cross-compiled, not console-executed.
- SDK v0.43 source inspection found a process-address cache keyed only by PID.
  The new injector compares that cached address with a bounded fresh allproc
  traversal before using it. A stale pointer, invalid list or exhausted traversal
  rejects the operation. The host runner executes the actual guard with controlled
  kernel-read responses, including PID reuse and list cycles. This prevents using
  stale addresses in this path; automatic cache recovery and the other existing
  SDK call paths still need a broader lifecycle audit before hardware acceptance.

The build manifest correctly reports `nativeInjectorCompiled: true` and
`coordinatorWired: false`. Still needed for usable PRX support: immutable module
staging, native container/platform validation, durable per-game request/arena
ownership, exact title/version checks at dispatch, coordinator/UI arming and
result reconciliation. The callback counters are input-call observations, **not
FPS**. In-game rendering/input arbitration and the remaining full TacHen scope
remain unfinished. Overall goal remains active.

## Eleventh implementation checkpoint: game module lifecycle

2026-10-07: **159 local tests pass**. The real QuickJS engine also passes the
updated registration and module receipt contract smoke check. The coordinator
cross-build is 8,489,176 bytes, SHA-256
`456911fd0137130d276e503b73def62ea7708f17f3865f2e1792f03ea0c1ce3d`.
The callback is now 784 bytes, SHA-256
`40bfa9862b5343e4115d89e76cccf63d0ab3a768b0fbbf918b0f0927bb3f9572`.
No console connection, console read or hardware test was performed. Nothing was
published or deployed, and the existing stable projects were not edited.

- Native `.prx`/`.sprx` registration, manual start and game/version autostart are
  connected to a dedicated game-module job adapter, not the standalone `.plugin`
  process loader. Arming autostart works before the game opens. A live load needs
  the exact platform, title, mounted version and process birth identity.
- The native worker owns the global native-operation guard before starting its
  thread. It hashes the complete input buffer, validates native dynamic ELF/SELF
  bounds, platform, mappings and dynamic metadata, and compares the running
  metadata digest with the coordinator's accepted game version. Unexpected
  imports or initializer failures remain the console loader's responsibility.
- Source review caught a visibility issue before hardware testing: a game cannot
  be assumed to see the coordinator's private `/data` tree. The shared native
  metadata reader now exposes a descriptor for the uniquely matched running
  sandbox. The worker stages read-only, hash-named files into that sandbox's
  `tachen-modules` directory through descriptor-relative, no-symlink operations.
  The callback uses `/tachen-modules/<hash>.prx` or `.sprx` from the game's own
  root. Private session receipts remain in `/data/tachen/modules`. No global
  mount, ShellCore data-access patch or game credential widening is introduced.
- Checksummed per-game records capture arena ownership, exact metadata digest,
  up to eight slot attempts, request/file hashes and both loader results. Durable
  intent precedes injection and slot publication. Interrupted arena creation
  blocks reinjection. A pending slot is written while all target threads are
  stopped, read back, then enabled and read back again. Partial failure restores
  the empty slot before resume; uncertain rollback or resume stays held.
- Native result inspection requires matching process generation, ownership
  cookie, exact staged path and two matching slot snapshots. A nonnegative handle
  with negative initializer status is not success and is not assumed unloaded.
  Interrupted slot publication can reconcile an initializer result from its
  retained control block, without replaying it.
- The coordinator distinguishes pending, initialized, rejected and unresolved
  operations. It blocks duplicate attempts in a game instance. A complete native
  census proving that the old instance ended can settle held jobs, allowing
  autostart in a new instance; missing identity or a busy census is not exit.
  Turning off autostart does not pretend to unload resident modules or undo their
  patches. No universal module-unload ABI is claimed.
- Host tests execute the real container parser, session checksum decoder and
  stopped-slot publication primitive, including malformed SELF/ELF, overlapping
  mappings, stale cookies, busy callbacks, partial writes and failed rollback.
  Coordinator tests cover exact targeting, game restart, changed context, failed
  initialization with a positive handle, timeout, disabling queued autostart,
  wrong-instance receipts and reconciliation after exit/reboot. Actual native
  loader calls remain unexecuted; mock API responses test contracts only.
- The phone flow was exercised against a localhost fixture using the actual
  server/UI: register a module, verify exact target fields and toggle autostart.
  At a 390-pixel viewport it had no horizontal overflow or browser errors.
  `build/prx-phone.png` records that check. The temporary server and browser tab
  were closed afterward. No native operation was run by the fixture.

The build manifest now truthfully reports `coordinatorWired: true` and
`injectionIntegrated: true` for game modules, with `hardwareVerified: false` and
`completeHen: false`. Deferred acceptance must verify real game sandbox access
and cleanup, imported module dependencies, PS4/PS5 module initialization, controller
behavior during initialization, shutdown/relaunch and absence of old-process
writes. Coordinator code also still needs the broader SDK process-cache audit
recorded in checkpoint ten, native cheat/MCP memory leases, FPS/resource overlays,
save operations, loadout application, update recovery, controller plugin controls,
safe plugin stop/restart and the remaining package firmware adapters. The overall
TacHen goal is active and unfinished.

## Checkpoint twelve — uncached native process lookup

The coordinator, managed deck and package helper now link `process-fresh.c` with
`--wrap=kernel_get_proc`. This removes the SDK v0.43 PID-only cache from active
lookup paths without modifying the installed SDK or existing stable projects.
Each call walks the current process list, validates kernel pointers, checks read
results and stops after at most 4,096 entries. CRT startup uses the same direct
getpid syscall ABI as the SDK, before imported functions are available.

This was checked at the final machine-code level, including SDK-to-SDK calls in
the same `crt1.o`, not just the linker command. `audit-process-links.py` decodes
every sized executable function and inspects allocated relocations in all three
ELFs. It rejects external references to the old lookup or its cache storage and
requires key SDK callers to reference the replacement. Its negative regression
changes a real compiled SDK call back to the old function and verifies rejection.
It is a static link audit, not proof of process lifetime or console behavior.

Host execution covers PID reuse with a different kernel object, a disappeared
PID, early-CRT current-PID lookup, invalid pointers, read failures and cyclic
lists. All **161 local tests** and the actual QuickJS core smoke check pass.
The runtime is **8,489,264 bytes**, SHA-256
`28b37afb40837d98404e1014bc9f5d8c7cfdd79e9199e09a34ac9376ff738b37`.
The deck and package helper were rebuilt too. Hardware remains untouched.

Fresh lookup does not make a process immutable between calls. Native cheat/MCP
work still requires stopped, generation-verified leases, bounded module/VM
inspection and transactional writes. Other SDK linked-list/tree walks are not
all bounded by this change. The remaining feature work and deferred hardware
acceptance described above still apply; this is not overall completion.

The next memory-access prerequisite is also implemented and cross-built in
`memory-map.c`: a bounded exact-basename module lookup and complete VM-span
inspection. Module lookup rejects duplicate basenames, malformed kernel pointers,
unbounded strings and list cycles. VM inspection checks contiguous coverage,
preserves each exact protection byte and rejects holes, overlaps, overflow and
cyclic trees. The VM-root offset must come from the initialized SDK. A valid
module base alone never proves that a requested interval is mapped.

The actual C readers execute in host tests against synthetic kernel layouts,
including changed module bases, gaps across entries with different permissions,
guard mappings at zero, injected read failures and bounded cycles. The full suite
now passes **162 tests**. Latest runtime: **8,489,448 bytes**, SHA-256
`186dcbfdc8e3e944b3d44ba6ee92e99a49aa65d6f5b67360b781d998bc985e6b`.
These readers are not yet exposed as a phone/MCP capability and do not acquire
or prove a stopped process lease. The immediate next integration is the native
atomic cheat worker: exact metadata/generation checks, stopped target, complete
before-byte validation, bounded patch transaction/rollback and confirmed resume,
then coordinator jobs and phone/controller controls. No PS5 test occurred.

## Checkpoint thirteen — native cheat transactions and shared controls

Exact-title/version JSON packs now persist as verified, hash-named files with a
bounded catalog and retained author credits. The phone imports and displays them;
the controller deck adds a Cheats page. Both submit the same durable `cheat.set`
job, bound to game generation, metadata digest and patch-plan digest. An enabled
label means the last verified operation, not a promise that another mod has not
subsequently changed game memory.

The native worker rechecks kstuff readiness, metadata and identity; stops the
target; uniquely resolves its module; checks the complete mapped range and every
expected byte before the first write; rejects patches overlapping a stopped
thread's instruction; and verifies applied bytes. Partial writes are included in
reverse rollback. Temporary mapping permissions and caller credentials are
checked/restored, and confirmed resume is required for success. Durable intent
is saved before attach. No disk flush is added while the game is stopped. The
two-second forward budget is checked between operations, not a preemptive
guarantee that a kernel call cannot stall. Interrupted or uncertain attempts hold
their resource ownership and are never automatically replayed.

The real C packet parser and transaction engine execute in host tests with
injected partial writes, failed rollback/resume, changed identity, permission
health failure and mismatched expected bytes. The full suite passes **170 tests**;
the actual QuickJS smoke check covers pack persistence and binary packet/receipt
contracts. The native worker's PS5 syscall and permission operations remain
unexecuted. A localhost phone check at 390 pixels found and fixed overflow and
undersized text fields; `build/cheats-phone.jpg` records the corrected layout.
The fixture executes no native operation and has been shut down.

Latest runtime: **8,523,520 bytes**, SHA-256
`ad55a103c68e7ac000845e0c4959d9f2020e4cb4562cea6706f98621bc80f804`.
Final ELF inspection accepts runtime, deck and package helper. Hardware remains
untouched. Nonzero sections, absolute/code-cave patches and encrypted/XML/BIN
formats remain unsupported by this execution adapter. Native MCP scans, overlays,
saves, loadouts, updates and the other outstanding work above remain unfinished;
this checkpoint does not complete TacHen.

## Checkpoint fourteen — opt-in MCP and native memory inspection

The console runtime now wires a Streamable HTTP MCP endpoint and phone connection
controls. Authorization is explicit, expires in one hour, never enters persistent
state or ordinary snapshots, and can be revoked locally. Session initialization,
protocol negotiation, tool discovery, bounded requests, Host/Origin checks and
disconnect are exercised through the actual localhost HTTP server. The client
cannot enable its own memory-write switch. Queued MCP cheats retain their access
grant and recheck it before dispatch; disabling or rotating access prevents a
previous queued write from starting. Regular controller/phone cheats retain their
existing path.

Native inspection reuses the kernel-copy guard, generation/metadata checks,
stopped-game lease, bounded module/VM readers and durable native receipt path.
It changes no target permissions or memory. The actual C inspection core limits
reads to 64 KiB, verifies identity between 16 KiB pieces, requires confirmed
resume/credential restoration and clears partial data after failure. Host tests
execute this core with failure injection. Actual attach/read/detach syscalls have
not run on hardware. Existing two-second inter-step limits are not preemptive
kernel-call guarantees.

The coordinator implements module information, bounded reads, and explicit
module-range hex/wildcard scans up to 16 MiB. It resumes between chunks, detects
cross-chunk matches, supports alignment, bounds matches at 8,192 and reports
truncation. Results remain in bounded RAM with a five-minute access window;
durable jobs contain identity/progress rather than memory dumps. Revocation and
cancellation stop between completed reads. Unknown resume holds exclusion and
can reconcile its original receipt or a proven game exit without replay. Whole
heap scans and unknown-value/differential refinement remain future work.

All **182 local tests** pass. The embedded QuickJS check executes inspection
packet/results and MCP initialization/discovery using test native contracts;
these are not hardware evidence. The rebuilt runtime is **8,573,120 bytes**,
SHA-256 `505334d9b811bc1ce1f0bef227edec5c6c8d569e9a580e898ab6810ae3cf095b`.
At 390 pixels, the real phone UI can enable developer access, create a local
fixture connection and revoke it with visible confirmation, without horizontal
overflow or browser errors. `build/mcp-phone.jpg` shows the revoked state without
a credential. The localhost fixture and browser were closed afterward.

Remaining hardware acceptance includes real stopped-game reads, timing while
playing, cancellation/revocation, restart recovery and third-party MCP clients.
The broader in-game deck, overlays, saves, loadouts, update recovery, remaining
format/firmware adapters and other open requirements still apply. No console
connection, test, deployment or publication occurred. TacHen remains unfinished.

## Checkpoint fifteen — PS5 telemetry and shared readout

The runtime now compiles and wires a native point-sampling worker for process
CPU time/resident memory, PS5 AGC ring/driver counters and the DCE display query.
Requests bind PID, process generation and title. The worker owns the native
kernel-copy guard, translates fresh user pages and rechecks identity before and
after reads; module identity is checked around the driver-counter observation.
There is no process injection, ptrace, credential change or disk publication in
this sampler. Its live observations are not atomic process snapshots.

Source inspection found that SDK v0.43's generic process-copy fallback clamps
later physical chunks to the original total length rather than the remaining
length. The sampler therefore uses the SDK page translator with TacHen's own
bounded per-page copy loop, not the generic process-copy fallback. The actual C
tests exercise an unaligned page crossing with output canaries, mid-read identity
loss, short/failed translations, failed reads, ring wrap, malformed headers and
concurrent ring resizing. Partial output is discarded. This does not establish
that arbitrary kernel calls cannot stall; a pending native worker retains its
guard and is not replaced when the coordinator's freshness deadline expires.

Portable telemetry retains 64-bit counter precision, rejects stale/regressing
intervals, averages current observations, and separates display scanout from
game render counters. CPU is the game's share of total logical CPU capacity.
Missing readings remain unavailable. Monitoring makes no native requests when
disabled, in safe startup or without a verified game. Queued native work takes
precedence. In-flight samples are drained and discarded after settings or game
identity changes. Values are transient and never written to saved settings.

The phone Preferences panel displays shared readings; native deck wire version
2 appends an independently sequenced metric label. Changing measurements does
not regenerate action tokens or interrupt a controller selection. The C decoder
rejects stale/contradictory metric revisions. A lost native connection clears
the metric label with the rest of the presentation. The actual managed label
placement and native sampling remain hardware untested.

All **191 local tests** pass, including the actual C counter/page reader and
controller engine. The real embedded QuickJS smoke test passes with 64-bit
telemetry and the revised wire format. All three ELFs cross-build; the runtime
is **8,590,312 bytes**, SHA-256
`ec786fb0cd040aee773fe8a580432c30e685cf40658bb3c0cec0348ab96ce8ba`.
The localhost phone fixture displayed synthetic 60 FPS, 50% CPU and 512 MiB at
390-pixel width without overflow or browser errors. `build/telemetry-phone.png`
records that UI check, not a console measurement. The fixture was stopped and
its browser tab closed; the temporary viewport was reset.

Next implementation work includes the separate PS4 GNM submission hook and
full in-game rendering/input integration. The earlier save, loadout, update,
firmware/format and other requirements remain open. Counter interpretation,
overhead, interaction with native jobs and lower-firmware behavior require
hardware acceptance later. No PS5 connection, deployment or release occurred.

## Checkpoint sixteen — PS4 frame counter integration

PS4 game FPS preparation is now wired into the native runtime and shared job
queue. It verifies the mounted metadata, exact process generation and kstuff
readiness before stopping the game. A unique supported GNM flip export is
required; ambiguous exports and existing entry hooks are rejected. Relocation
stages code in RX pages with a separate RW counter/control page. Publication uses
the existing stopped-thread transaction, rollback and resume checks. The inline
indirect jump retains read permission on originally execute-only mappings.

Each game instance gets a checksummed durable intent before dispatch. Interrupted
or rejected attempts are not automatically replayed. Confirmed installations can
be recovered after coordinator restart; sampling separately checks current game
identity, the exact installed entry bytes and the control cookie. No receipt is
written after injection unless target resume was confirmed. Uncertain outcomes
retain queue exclusion. A verified game exit can settle that operation without
installing another hook in the old instance.

This counter measures flip submissions, not successful presentation. Disabling
FPS stops sampling but leaves the small entry counter installed until game exit.
The enabled/cookie control block and atomic increment do not call game functions
or move stack arguments. Actual host execution verifies ten SysV integer
arguments, preserved flags, disabled/enabled behavior and 40,000 concurrent
increments. JavaScript tests cover dependency changes, process changes, busy
workers, recovery, non-replay and counter reset/missing data. The embedded
QuickJS test executes coordinator preparation against a test native contract.
These do not exercise console ptrace, mapping permissions, GNM calls or storage.

All **197 local tests** pass and the embedded QuickJS check passes. All three
ELFs cross-build. The runtime is **8,608,008 bytes**, SHA-256
`f9d912ba51239ff243919fe0236e33f8c3edd05ef2807ba5b1444429677a42da`.
Hardware acceptance must still establish PS4 export compatibility, sampling
accuracy, overhead, restart recovery and interaction with games and plugins.
Full in-game rendering/input, saves, loadouts, updates and the other previously
listed requirements remain open. No console contact or publication occurred.

## Checkpoint seventeen — retain ownership on interrupted attach

Reviewing the input integration uncovered older game/deck injection callers
still using the convenience attach wrapper. A ptrace attach can be accepted
before a later stop wait or credential-restoration check fails. These callers
now use the ownership-preserving API, and hook publication attempts detach on
an attach failure. Detach is a no-op when an adapter never acquired ownership.
The actual publication-core host test now injects an accepted-but-failed attach
and verifies no patches are written and resume cleanup is attempted.

Game and deck injection report whether their final detach was confirmed. Their
workers avoid filesystem outcome writes when it was not, retaining the durable
pre-operation intent and publishing an uncertain in-memory result. Module-slot
publication likewise postpones its failed-attach/detach outcome write until
cleanup confirms resume. This fixes ownership bookkeeping; it does not promise
recovery from a kernel call that never returns or from a failing detach syscall.

All **197 local tests** pass, including the expanded native publication test.
The console artifacts cross-build; runtime **8,608,008 bytes**, SHA-256
`0e11ee26a6d0d17bb34a4b9edc73851f3742b444e343137adb448a147a941dcc`.
No console was contacted. Actual attach-failure and resume behavior remains a
hardware acceptance item.

In-game deck work remains next. The current managed GamePad hook only consumes
ShellUI input; it does not establish that game input is consumed. The existing
game PRX trampoline is a pre-call callback, so it cannot filter the returned
pad sample. The native menu needs a real post-read path and shared capture
ownership, with release on renderer loss and without redirecting stale game
handles. Public normal-pad interoperability research was inspected at
`blackbearreloaded/ps5-native-gamepad-input-research` revision
`10667715140895b313d88613e416d9495e7e5387` (local ignored checkout
`.local/gamepad-research`). It documents 120-byte samples, capacities 1–64,
and centered stick bytes of 128; static declarations are evidence to validate
against supported runtime ABIs, not proof of every firmware/game. No research
code has been incorporated at this checkpoint. Full in-game rendering/input
and all remaining scope are still outstanding.

## Checkpoint eighteen — native post-read input bridge

The game injector now stages a separate post-read pad bridge at arena + 0x2000
and its control block at + 0x5000. Existing module slots retain their original
control ABI. The typed entry stubs call the relocated original scePadRead or
scePadReadState using their three- or two-argument SysV signatures and preserve
the returned result. Module initialization still uses the earlier callback gate.
Invalid/disabled bridge state passes through the original read; a successful
normal read can be inspected only after it returns. Failed reads, oversized
results and malformed samples do not produce manufactured successful input.

Capture remains **disabled** in this build. The future supervisor must verify
normal-pad compatibility and renderer readiness, bind the game generation,
enable the bridge, drain its events and publish a coherent lease. No UI control
currently claims that this supervisor or full in-game input is available.

The bridge has one lock with nonblocking acquisition, a 128-event ring, at most
eight controller records, and monotonic leases no longer than 500 ms. Only the
named handle and connection generation are captured. Motion/touch/buttons are
neutralized while preserving connection, timing and device metadata; centered
stick bytes are 128. On release or expiry, held input drains for at most another
250 ms, bounded by the original lease deadline even if the game stopped reading.
Overflow or capture contention invalidates that capture epoch. Reopening old
handles can reuse expired controller records. Nested reads do not report the
inner hook's neutralized buffer as a physical release. No file/network I/O,
allocation or waiting occurs in the filter. Its only timing call is the target's
clock_gettime(CLOCK_MONOTONIC); a missing/failed clock leaves input unchanged.

The actual freestanding bridge binary and generated entry stubs execute in host
tests. They cover both call signatures, unchanged native failures, passive
observation, ownership, reconnects, lease expiry, a sleeping game, release drain,
contention, batch boundaries/canaries, overflow/recovery, sequence wrap and nested
reads. The full suite passed **198 local tests**, followed by a focused rerun
after making the ReadState call explicitly two-argument. All console artifacts
cross-build. Runtime **8,608,136 bytes**, SHA-256
`af84bbf97513373ba767571e4ff28461388390e57f24cce01810bcaae26e6837`;
bridge **2,816 bytes**, SHA-256
`5c592ffaaba3f2d21e2c8f4b90672163c9e1b31a04fff3b164f1b53e426b2d59`.

This is implementation evidence for the game-thread half, not native API or
hardware validation. The control supervisor, event-to-deck routing, renderer
loss handling across processes, independent arena startup without a PRX, and
normal-pad runtime compatibility checks remain next. Extended input APIs need
separate adapters. Full in-game presentation and the rest of TacHen's requested
scope remain unfinished. No console connection, test or publication occurred.

## Checkpoint nineteen — independent callback and private input transport

The coordinator now prepares the shared game callback without requiring a PRX
plugin. It binds a durable request to PID, process generation, title/version and
mounted metadata, and checks kernel-service and native-renderer readiness. The
input request and PRX requests share native ownership and queue exclusions;
preparation consumes no module slot. Existing callbacks can be adopted, while
interrupted/rejected requests are retained without automatic reinjection. The
private module receipt is version 2; older development receipts are rejected
rather than interpreted under the new layout. An unconfirmed game resume keeps
the original disk intent and publishes uncertainty only in memory.

The native input exchange runs on a separate worker under the common native
operation guard. It accepts identity and lease fields, never arbitrary user
addresses. A RAM-only lookup selects a prepared game session. Process identity,
module-gate cookie and pad header are checked before exchange. Reads and writes
translate every 4 KiB page freshly and check identity around each copy. Writes
are restricted to the private pad lease, consumed cursor and enable flag; no
ptrace, credential changes or filesystem operations occur in this path.

The transport drains only published ring entries before advancing their cursor.
It checks sequence wrap and concurrent faults, flushes old events on a new epoch,
and publishes a lease through odd/even revisions with readback. Lease expiry is
400 ms from the exchange's initial monotonic timestamp; exchanges taking over
100 ms are discarded. A copy failure can be partial and is reported uncertain,
without replay or rollback of a live lease. These checks bound accepted results
and memory operations; they do not preempt a kernel syscall that stops returning.
Turning capture off preserves the filter's short release drain so the closing
Circle/X press does not immediately become a game action. A stopped coordinator
cannot keep renewing capture.

The full suite passed **204 local tests**, and the embedded QuickJS fixture
passed. After correcting the explicit-release drain, the seven affected tests
and final ELF process-link audit passed again. Tests execute the actual compiled
pad bridge with the real C exchange protocol using local copy adapters, covering
observation, capture, event consumption, release and expiration. Fault injection
covers every protocol write, including accepted-but-reported-failed writes;
bounded page writes are tested across page boundaries and identity loss. The
PS5 kernel copy adapters and worker are cross-built only. Runtime **8,642,008
bytes**, SHA-256
`ef8432520076867f9c0e5c70f4afc4c23cea69c1f7d055e6b7e700fe29ef879f`.

Capture remains disabled by the coordinator. Next is the renderer/input
supervisor, event-to-deck routing, controller ownership and renderer-loss
handling across processes, including normal-pad compatibility checks. The
transport alone does not deliver a usable in-game menu. Full presentation,
saves, remaining cheat formats, per-game loadouts, recovery/update flows and
older-firmware installer ABIs remain outstanding. No console was contacted and
no artifact was published.

## Checkpoint twenty — renderer-to-game input handoff

The coordinator now relays normal game-pad events to the native deck. Its private
wire is version 3, **6,120 bytes**: menu identity and telemetry retain their
original offsets, with a separate input epoch, packet serial, lease deadline,
capture acknowledgement and up to 128 events. Input traffic does not replace
menu action tokens. The loopback-only authenticated `/native/deck/sync` endpoint
carries renderer feedback and any existing deduplicated menu action together.
Phone cookies and browser-origin requests cannot access that endpoint.

The native route maps standard pad button bits to the shared controller engine.
L3 + R3 requests menu ownership; the menu is presented only after a matching
capture grant. Actions additionally require a render acknowledgement. Events
collected before capture was granted update held-button state but cannot select
an item; the initial grant timestamp survives subsequent renewals. Controller
handles are bound to connection generations, with eight bounded native slots.
Another controller cannot operate the owned menu, and a reconnect resets its
ownership. Normal ShellUI input is not fed into the menu during game routing.

The JavaScript supervisor uses the native monotonic clock, serial-matched native
worker results, short renderer-feedback deadlines and acknowledged event packets.
It never replaces a still-running worker. Stale feedback, late results, changed
games, uncertain startup or mismatched receipts withdraw capture. A fresh epoch
flushes previous events. Invalid or missing game identity blocks game input
routing rather than treating the unknown state as dashboard input. Queue jobs
take precedence; leases expire if a long operation prevents renewal. A confirmed
short input worker defers the game census for 25 ms, avoiding a false game-loss
transition. Resident service checks likewise distinguish native contention from
actual readiness-loss evidence.

The build and **211 local tests** passed, plus the embedded QuickJS fixture.
After the service-contention correction, its affected 16 tests passed again and
the rebuilt ELF process-link audit passed. Native C tests cover chord ownership,
capture/render acknowledgement, pre-grant presses, other controllers, reconnects,
stale input, packet deduplication and returning to dashboard routing. JavaScript
tests exercise relay receipts, withheld acknowledgements, renderer loss, worker
stalls, generation changes and wire encoding. A real localhost HTTP fixture
checks the sync endpoint's credential/origin boundary. The platform kernel and
managed renderer APIs remain untested on PS5. Runtime **8,642,040 bytes**, SHA-256
`9d509fd362151bc4f1b62bcc772e5ed2b1e16330c0b7368c3cb58435c2bd40aa`.

This completes the code connection between the current game callback and native
controller menu; it does not establish hardware usability, focus behavior,
performance or compatibility with every game. Extended/device-specific pad APIs
still need separate adapters. The original visual design remains to be finished.
Next substantial scope includes save extraction/decryption/export, runtime
loadouts, remaining cheat formats, recovery/update flows and older-firmware
installer ABIs. The full TacHen goal remains active. No console connection,
hardware test, public deployment or release occurred.

## Checkpoint twenty-one — per-game loadouts

Loadouts now have a runtime service and phone editor, rather than only a saved
schema/planning utility. Each setup binds an exact title/version, up to 32
registered plugin hashes and 64 imported cheat references, overlay choices and
an opt-in automatic-start flag. Stored profiles are validated on every state
commit. Revision checks prevent stale editors from overwriting newer choices.
The phone supports editing, removal, preflight review and application. The
controller Games section reviews/applies the same setup, controls automatic
startup and releases its temporary overlay. Reviewed actions retain the profile
hash and complete game identity; later changes invalidate the request.

One loadout coordinator occupies at most one queue slot; child operations use
the other slot and the existing native dispatch/resource exclusions. Multiple
coordinators cannot deadlock both slots waiting for children. Preflight checks
all referenced files, targets, adapters and overlay capabilities before any new
dispatch. Children retain their existing native byte/identity checks. Plugin
launches, native modules and cheat changes are individually recorded, with a
durable checkpoint before child enqueue and a deterministic child request key.
Recovery can identify a child accepted between the two checkpoint writes; it
does not replay later steps or reapply an overlay after a restart.

Existing successful module/cheat operations may be reused, and standalone
plugins additionally require the original live process identity. Adoption is
checked again at its execution step. A clean child failure stops the setup with
an explicit partial result; an unknown child holds the coordinator until that
child can be reconciled. This is deliberately not an atomic rollback promise:
resident plugin code stays resident. Activity distinguishes a stopped loadout
from a fully applied one and lists its individual operations.

Automatic setups suppress independent autostart for their selected plugins,
wait for native/overlay readiness, and attempt once per game generation.
Missing/incompatible selections remain held for review. Game-instance overlay
choices are RAM-only, feed the same renderer/telemetry/PS4 preparation paths,
and stop applying after the game identity changes. Explicit preference changes
override the active overlay. Removing a saved setup does not unload modules,
reverse cheats, or undo the active session; the user can separately release its
overlay and use the existing cheat controls.

The full suite passed **222 local tests**, including eleven loadout integration
checks through the real queue, state store, plugin/module handlers and cheat
service with mocked native boundaries. They cover preflight rejection, duplicate
coordinators, partial/unknown outcomes, game changes, adoption, autostart,
checkpoint recovery, controller confirmation and saved-state validation. The
actual embedded QuickJS engine also executes a saved overlay loadout through
the real coordinator/queue. Local browser testing exercised editing, saving,
review, apply and completed Activity using an in-memory loopback fixture, with
the editor visually inspected at 390px width. Those are not console tests.

All artifacts cross-built, and the three-ELF process-link audit passed. Runtime
**8,674,808 bytes**, SHA-256
`1ad27cedca49fc7f417bec2ab15ef04efacbac7b4a75c46460a25d8136ea1b0e`.
Hardware acceptance still needs actual plugin/cheat combinations, game changes,
controller use, phone disconnects and startup timing across supported firmware.
Save extraction/decryption/export, remaining cheat formats, full presentation,
recovery/update flows and older-firmware installer ABIs remain outstanding.
The original full goal is active. No console was contacted, and no deployment
or public release occurred.

## Checkpoint twenty-two — save extraction and USB/FTP export

An embedded, isolated save helper now connects to the real job queue and both
user interfaces. Its explicit catalog job reads PS4 `savedata` and PS5
`savedata_prospero` containers under local user directories. Entries bind the
user/title/slot, platform, file metadata and sealed-key identity; USB choices
bind the mounted device identity. Catalogs include skipped-entry counts and are
bounded to 2048 saves. No native save scan runs automatically while idle.

Exports require a closed target game, supported exact firmware profile and
verified kstuff before dispatch. The helper opens installed containers read-only,
copies the image into private staging and verifies the entire copy by read-back
SHA-256. It obtains the key through the console's PFS service, using the PS4
companion key file or PS5 image key location. Credential changes are confined
to that helper and verified on restoration. Mounting never targets the installed
save. PFS research and existing Neighborhood provenance are recorded in
`vendor/save-provenance.json`.

Extraction walks descriptor-relative directories without following links or
nested mounts, streams file data with bounded buffers, preserves empty
directories, and writes a PAX tar containing a file-hash manifest. UTF-8 paths,
long paths and files above the traditional tar eight-GiB size limit are handled.
Limits are 32 GiB of file data, 10000 entries and 32 directory levels. Space
checks use the actual encrypted copy and streamed archive requirements with a
small reserve; they do not multiply the source size by an arbitrary factor.
The full archive is read back and verified before publication.

Unmount must be confirmed before publication or cleanup. A mount call returning
an error still goes through mount-state reconciliation; a negative return alone
is not treated as proof that nothing mounted. The helper's watchdog and durable
phase receipts retain uncertain results. Such work is not replayed, and the
queue holds its exclusion. Known clean failures discard only fixed staging
filenames; no recursive deletion runs against a potential mount. Unknown
mount/publication state is preserved for inspection; automatic cleanup/recovery
of those cases remains part of the outstanding recovery work.

FTP exports publish under `/data/tachen/share/saves/<request>/save.tar`, with
the share-relative path shown to the user. Same-filesystem rename avoids a
second local archive copy. USB exports go to `TacHen/Saves/<request>/save.tar`
on the selected drive, with copy and read-back hashes checked before the final
name is published. The verified USB directory descriptor is retained while
creating children, preventing a disconnect from redirecting writes to an
unmounted USB placeholder. Source, destination and game state are rechecked
during long transfers and before publication. These checks provide point-in-time
verification, not a guarantee against later edits to a completed export.

Phone users can refresh, search, page, select a destination, confirm export and
see the verified output path. The controller Games submenu supports catalog
refresh, save paging, USB/FTP destination review and the same export job. Both
use Activity progress and durable result reconciliation. Recovery startup blocks
these optional helper launches even through direct command calls.

The build passed with warnings treated as errors for the new native save code.
All **235 local tests** passed, including independent Python tar-reader checks,
native failure-path injection and queue/controller integration tests with mocked
platform boundaries. The embedded QuickJS fixture executes a catalog job. The
four-ELF process-link audit passed. A real loopback browser fixture exercised
catalog refresh, export confirmation and visible completion; the 390-pixel phone
view was checked and a long-path horizontal-overflow defect corrected. This
browser fixture did not perform PFS decryption or access console data.

Runtime **8,873,520 bytes**, SHA-256
`bf2fd93c289495cc92d925f0ee4a4035db8533a60feb4877f1c9e24a5dba69ef`.
Embedded save helper **155,472 bytes**, SHA-256
`34ce09df4d3d791e121ccc0de7acf89076f9ac2da52f191d3164eb432a600f42`.

Hardware acceptance must verify symbol availability, credential restoration,
PFS mount/unmount behavior, PS4 companion-key and PS5 image exports, archive
contents against a known save, USB disconnect handling, low-space behavior,
game-start races, large saves and cross-firmware compatibility. No console was
contacted, no payload was sent, and no public deployment/release occurred.
The full goal remains active: original presentation, remaining cheat formats,
history/undo, adaptive notices, update/recovery flows, support diagnostics,
older-firmware installer ABIs and full hardware acceptance remain outstanding.

## Checkpoint twenty-three — shared session history and supported undo

The runtime now records actual preference differences, verified plugin
registration, autostart changes and saved-loadout edits alongside current-session
job results. Both Activity interfaces present the same bounded history and review
the proposed reversal before confirmation. Configuration changes are capped at
256 records / 512 KiB; the combined view shows at most 256 entries. Unchanged
state, game identity and recovery mode reuse a cached presentation. No extra
native probes or timers run merely to display history.

Preference undo restores only the affected fields, preserving unrelated later
choices. Same-field edits, including a value changed away and back, must be
reversed in order. Persistence, capability validation, reversal marking and the
new history entry share a transaction. Failed commits do not run overlay/reset
side effects. Developer permission changes cannot be undone to restore grants.
Plugin autostart and saved loadouts can be restored, with explicit notice that
this may arm future launches but does not unload already applied code.

Successful cheat transactions can enqueue the inverse checked patch against the
original boot, process generation, title, version and metadata. Successful mount
changes can restore the prior state against the same ShadowMount instance and
source identity with the game closed. The queue checks reversal references and
conflicts atomically at acceptance, again at validation, and before dispatch.
Concurrent requests adopt one durable reversal. Later conflicting operations,
replaced processes/services, invalid proofs and unconfirmed outcomes cannot
silently retarget or replay it. A caller cannot manufacture a mount's prior state;
completed no-op mounts do not block a genuinely earlier reversible change.
ShadowMount's remote state checks are point-in-time observations, not an atomic
transaction against independently acting external clients.

There is deliberately no generic plugin unload, package uninstall, save deletion
or storage rollback behind Undo. Those rows explain the actual limitation.
Reversals themselves are recorded but are not a redo stack. Earlier runtime
sessions remain in operation storage as applicable but are not offered for undo.
Controller Circle navigation returns through confirmation, review, history and
Activity. Expired entries produce a back action instead of breaking the deck.

All **250 local tests** passed, including fifteen new configuration/native-job/
controller checks. Coverage includes concurrent requests, stale reviews, ABA
edits, failed persistence, replaced game/service identity, later queued conflicts,
unknown native receipts, forged references/prior state, no-op mounts and history
expiration. The native boundaries in these tests are fixtures, not PS5 execution.
The actual embedded QuickJS fixture performs reviewed preference undo. All
artifacts cross-built, and the four-ELF process-link audit passed. A loopback-only
browser fixture verified preference change → review → undo → completion and a
390-pixel phone layout; its temporary server and browser were closed afterward.

Runtime **8,906,288 bytes**, SHA-256
`021d5b589b25d51e58069e8aad31b169fb56510d0b1c6926e9709f7ca9c3dfe3`.

No console was contacted or payload sent, and no public deployment/release
occurred. Full hardware acceptance remains deferred. Original visual presentation,
remaining cheat formats, adaptive notices, update/recovery flows, support
diagnostics, older-firmware installer ABIs and other items in the full goal remain
active; this checkpoint does not claim TacHen is complete.

## Checkpoint twenty-four — adaptive session notices

The runtime now observes existing durable-job and service-state publications for
verified results and actionable failures. It adds no polling timer or native
probe. Success notices use 5.5 seconds on the dashboard or 3.5 seconds in a game,
with longer gaps during play; attention notices use 9 seconds and can replace a
success notice. Related bursts group into one item without renewing its lifetime.
Pending notices are bounded and expire after 30 seconds. Routine save-list,
game-input and FPS preparation successes and developer memory reads stay quiet.
Timeout-to-interrupted transitions are one incident. Dispatched payload/plugin
code is described as dispatched, not as feature initialization. Partial loadouts
and unconfirmed patches whose game ended require review rather than a success
claim. Service dependency failures, recovery startup and a halted job queue are
also represented. An expired current item is cleared before new events are
grouped, fixing loss of a new incident after an unobserved idle gap.

The phone shows a bounded, wrapping card with Activity/Components navigation and
shared dismissal. It owns a local expiry timeout which repeated state responses
cannot extend. Explicit disconnect clears the card. Both phone and controller
Preferences expose the adaptive toggle; turning it off clears visible/pending
items while still observing state transitions, so enabling it does not replay
old events. Controller Activity includes dismissal. No notice starts, retries,
cancels or reconciles underlying work.

The private deck wire is now version 4, 6424 bytes, appending a 304-byte notice
after the existing independent input fields. Its own sequence does not alter
controller menu tokens. The C decoder validates the bounded notice and rejects
unsequenced text changes or stale sequences. The consumer pins a monotonic local
deadline on receipt and never renews it from repeated frames, including after a
stale connection. The render thread consumes two additional managed labels, hides
them while the command deck is open, and clears them on local expiry or stale
coordinator readiness. All old input/telemetry offsets remain unchanged. Actual
ShellUI rendering and overlay placement still need hardware acceptance.

All **259 local tests** passed, including nine new notice tests and extended
actual-C wire/expiry checks. These cover grouping, duplicate phases, in-game rate
limits, disable/re-enable, dispatch semantics, service/queue faults, expired-idle
incidents, clock rollback and menu identity preservation. The embedded QuickJS
fixture verifies a completion notice after a real fixture loadout job. The build
and four-ELF process-link audit passed.

A loopback-only browser fixture verified the 390-pixel layout. Its native export
confirmation stalled the test tab's input transport; a fresh tab rendered the
notice, but pointer/keyboard button effects could not be reliably verified in
that session. The saved visual uses a deliberately frozen coordinator clock to
make the short-lived card inspectable; it is not console or timing evidence.
The browser's local expiry still hid the card while the fixture clock remained
frozen. Viewport override was reset and the fresh tab closed; closing the original
stalled temporary tab timed out. Both temporary server processes were stopped.
Browser navigation/dismissal interaction remains a follow-up acceptance item.

Runtime **8,906,288 bytes**, SHA-256
`61418e59ea2db130531a5bbec167118763ff1c68804ce5e48475d89dd94b4e65`.
Internal deck **130,880 bytes**, SHA-256
`e058edaba79519f093973d7e9484752612205b29f3ab317bb44cdd09fc8ea76a`.

No PS5 was contacted, no payload was sent, and nothing was deployed or published.
The full goal remains active, including original presentation, remaining cheat
formats, update/recovery flows, support diagnostics, older-firmware installer
ABIs and deferred hardware acceptance. This is an implementation checkpoint,
not a claim that the complete HEN is finished.

## Checkpoint twenty-five — opt-in support captures

The phone Preferences page now has a separate Support capture section. Recording
is off by default, independent of MCP permissions and preserved as the latest
explicit choice during safe configuration recovery. Users can enable recording,
disable it while preserving existing evidence, download a JSON report and clear
the saved captures. There is no reporting/upload server. The authenticated
same-origin command API and CSRF checks protect export/clear; normal polling
publishes capture counts and storage status, not report contents.

The recorder observes coordinator startup, service/queue transitions, job claims
and outcomes, game identity/lifecycle and selected native receipts. Payload,
deck, plugin/module, cheat, input, PS4 FPS, package and save adapters pass their
observed stages through a numeric/boolean allowlist. Component readiness now
has distinct reason codes for hooks, process/listener disagreement, unexpected
APIs, independent manager startup and lost readiness. Native prose, paths,
credentials, upload identities, request keys and raw memory are omitted. Jobs
get local aliases and earlier-session work is labelled rather than replayed as
a fresh failure. Reports identify the exact embedded source fingerprint and
bundled component hashes; this is separate from the final ELF hash.

Three captures retain 512 events each, preserving the first 64 and most recent
events with explicit omission/truncation metadata. Two independent revisioned,
checksummed snapshots use the existing atomic file replacement adapter under
/data/tachen/state. A valid older slot recovers a torn write. Both corrupt slots
are preserved until explicit clear. Disk-write failures cannot halt the work
queue; RAM export reports the persistence failure. Writes are bounded to one
active/coalesced successor, with no extra polling timer. A follow-up check fixed
export starvation under a continuous stream of new events: export no longer
waits for all future writes to drain. Clearing replaces both slots before
starting a new enabled capture.

All **271 local tests** passed. New coverage exercises consent, real dispatch
adapter failure receipts and redaction, startup failure ordering, reopening,
torn/corrupt slots, failed diagnostic writes alongside successful ordinary jobs,
bounded/coalesced history, continuous activity during export, safe recovery,
earlier-session jobs and authenticated API behavior. The actual embedded QuickJS
fixture exercises capture/disable/export/clear; the native build and four-ELF
process-link audit passed.

In a real loopback development browser, enabling and disabling capture worked.
Download produced a valid TacHen-support.json in the local Downloads folder.
The browser automation download-event waiter timed out even though the file was
saved; filesystem inspection confirmed the JSON product/schema, development
mode and captured events. The support panel fits a 390-pixel viewport. Screenshot:
.local/support-phone-preview.png. Viewport override was reset, both current and
obsolete temporary preview tabs closed, and the development server stopped.

Runtime **8,939,056 bytes**, SHA-256
`aecd884c2215d6611036db57391e00e551e611b096bf652151d4d4683376f3cb`.
Source fingerprint
`831c5b339d845b1e1352280ff29da7c6a11d2a535367dc1b9c8df4bff1f3ac2b`.
Native deck remains **130,880 bytes**, SHA-256
`e058edaba79519f093973d7e9484752612205b29f3ab317bb44cdd09fc8ea76a`.

Power loss can omit a pending capture write. Unconfirmed stop is not proof of
a crash; coordinator close is not proof that native workers settled. Early
native startup before JavaScript, stages between polls and omitted ring events
are outside the capture. Console durability and real failure coverage remain
untested. No console was contacted and nothing was published or deployed.
The full goal remains active, including original visual presentation, remaining
cheat formats, update/recovery flows, older-firmware installer ABIs and hardware
acceptance. This checkpoint does not claim TacHen is complete.

## Checkpoint twenty-six — reviewed native startup recovery

Native startup now reserves the queue before automatic game consumers start.
The ordered kstuff, command deck and selected ShadowMount/Payload Manager steps
write a durable startup marker before dispatch, keep unrelated native work held,
and verify the complete configured set again before saving known-good preferences.
MCP authorization is not promoted into that recovery configuration. Startup failure
keeps recovery enabled; failure to save that failure also halts the work queue.
Automatic plugins/loadouts, telemetry, lifecycle and input preparation wait through
the reservation. A validation that began earlier cannot bypass admission when its
durable intent commits. Existing accepted request identities remain idempotent.

Phone Components and controller Home expose a read-only startup review and explicit
confirmation. Plans distinguish reusable, absent and uncertain services, and block
on unrelated unfinished work. Confirmation binds the reviewed configuration revision,
boot and observed service identities. Changes during asynchronous inspection reject
the review; the serialized startup-intent commit checks its revision again. This does
not create an atomic snapshot of console processes: native dispatch and readiness
adapters must still verify their current observations.

Loader and deck receipts now expose their recorded boot identity. Only component
and deck startup handlers can expire a previous-boot intent, with a second matching
boot-expiration check before reconciliation. The outcome records that the prior
result remains unknown. This cannot be used to discard uncertain packages, save
exports or other filesystem effects. A new coordinator in the same boot cannot
adopt an old deck carrying a different private credential; it requires a console
restart instead of another injection. Clean pre-execution failures can be reviewed
and retried with a new durable request identity.

All **284 local tests** pass. Coverage includes ordered readiness promotion, clean
retry, same-boot uncertain dispatch refusal, new-boot expiration, old renderer
ownership, stale configuration/service/boot proofs, asynchronous review changes,
queued storage writes crossing confirmation, storage failures, admission races and
controller confirmation. The embedded QuickJS fixture exercises reviewed recovery.
The native build and four-ELF process-link audit pass with no legacy references.

The actual loopback browser flow displayed the plan, accepted confirmation and
showed the saved verified-startup state against simulated native services. The
390-pixel layout is captured in .local/recovery-phone-preview.png. These fixtures
never contacted a console and do not demonstrate actual kernel or ShellUI readiness.

Runtime **8,955,440 bytes**, SHA-256
`39c491e5a03464b3aca3c0285f9e14d7efc565090714974f16b7f7f661bb72e7`.
Source fingerprint
`5c35181356af3c48b5a9f7f38f57574166bcd97c05964dabade55f52426404ac`.
The deck binary remains 130,880 bytes with SHA-256
`e058edaba79519f093973d7e9484752612205b29f3ab317bb44cdd09fc8ea76a`.

Console acceptance must cover interrupted startup across cold boot, clean rejected
dispatch, same-boot coordinator replacement, real readiness delays and lost services,
controller/phone review agreement and storage failure. No console was contacted;
nothing was published or deployed. Artifact update rollback, original final visual
presentation, remaining cheat formats, older-firmware installer ABIs and deferred
hardware acceptance remain unfinished. The full TacHen goal stays active.

## Checkpoint twenty-seven — native launcher and staged build selection

Build output now includes a separate native tachen.elf launcher, a versioned
tachen-update.tachen package and the existing direct runtime. The launcher embeds
a fallback package and uses the existing credited ELF loader. Package headers
bind the payload length/hash, embedded source fingerprint, exact firmware bitmask,
state schema and bounded ASCII label. Both JavaScript and native code validate
the fixed 256-byte format. The native launcher additionally validates the complete
ELF and hashes the private byte buffer that it dispatches. Profiles exclude 11.40
and firmware below 11.00. Format 1 requires backward-compatible state schema 1;
checksums do not authenticate the publisher.

Native selection uses a separately locked pair of revisioned, checksummed binary
snapshots. Good, previous, candidate and attempted headers are retained alongside
the attempt's boot and PID. Intent commits before spawn. A recorded attempt is
not retried in the same boot. The runtime can acknowledge only the matching PID,
boot and compiled source identity, after all configured native services pass
readiness and their configuration receipt commits. A missing acknowledgement
returns to the good build on the following boot. Unreadable candidate files fall
back to a verified good/embedded image before any dispatch. A corrupt selection
snapshot prevents launch or mutation instead of guessing whether an intent ran.

An initial directly loaded runtime has no verified rollback target. It can upload
and stage a package, but cannot activate it until one launcher startup succeeds.
The native core and shared API both enforce this requirement. Manually choosing
the previous build, or cancelling a not-yet-running selection, does not unload
hooks or reboot anything. Cancellation preserves files. The launcher is not a
kernel exploit, and its embedded fallback does not bypass an invalid kernel state.

Update uploads use the authenticated same-origin/CSRF channel and an isolated inbox.
Staging is a durable filesystem job, available even while native startup is held.
It preserves existing builds, checks free space, streams a private copy, verifies
its payload hash, syncs and publishes it before selecting the candidate. Existing
files with conflicting metadata are preserved and rejected. The launcher rechecks
the complete file before execution. Progress persistence is throttled rather than
syncing one state revision per 64 KiB. Update selection uses its own expected
revision; an uncertain selection write requires reconciliation instead of blind
retry. The phone and controller share the same selection API.

All **291 local tests** pass. The compiled C runner covers first-baseline promotion,
no-baseline activation refusal, stale revisions, once-per-boot attempts, wrong
PID/source/boot acknowledgement, staged versus armed selection, unacknowledged
trial fallback, manual rollback, cancellation and malformed state. Cross-language
format tests include checksummed-but-invalid headers, schemas, profiles and changed
ELF bytes. Real desktop file tests cover successful staging, separate activation,
no-baseline refusal, corrupt bytes and preserved conflicting files. Startup tests
prove acknowledgement occurs only after committed complete readiness. Embedded
QuickJS also checks package encoding, decoding and corruption rejection. All five
ELFs pass native image inspection and the machine-code process-lookup audit; the
negative audit test still detects an intentionally regressed SDK call.

The actual loopback browser uploaded a built update, staged it, reused its retained
upload and confirmed next-boot selection against a simulated native selector.
After adding the first-baseline requirement, the phone explicitly held activation
and displayed the reason. The 390-pixel layouts are captured in
.local/updates-phone-preview.png and .local/update-baseline-preview.png. The former
captures the earlier selection flow; the latter captures the final no-baseline
guard. A final copy edit changed the stage heading to the neutral “Package staged.”
All temporary tabs and preview servers were closed, and viewport overrides reset.

Runtime **8,989,736 bytes**, SHA-256
`3e740a68a2e04734fc2c93d2391f1e82e48ccf95856ee68eb33658c3b19152bc`.
Launcher **9,135,048 bytes**, SHA-256
`2858932fc3d9eedae99a765231692c24cb46e9efca4e0c6448e91fdcef217b86`.
Update package **8,989,992 bytes**, SHA-256
`dd3c1fda10860b76df2119adb31626610c19f320e7f793164f2c67826f5f1b16`.
Source fingerprint
`579d47bef06be0cfe6495c43e5731bdb14f3b62e8cbd1a91f83a49ad59fa8a8c`.

These checks do not exercise PS5 spawn, native disk durability or real cold-boot
recovery. Native I/O fault injection, bounded removal of unused package files,
later-crash/manual recovery acceptance and firmware coverage remain outstanding.
There is no updater signing/deployment infrastructure or automatic remote update.
No console was contacted and no artifact was published. The goal remains active,
including final original presentation, remaining cheat formats, save recovery,
older-firmware installer ABIs and deferred hardware acceptance.

## Checkpoint twenty-eight — native update I/O failure tests and retained packages

The host runner now compiles the production `update-io.c` against a bounded
in-memory syscall boundary. It injects short reads/writes, EINTR, no-progress I/O,
open/stat/write/sync/close/rename failures, corrupt or mis-slotted snapshots,
symlinks, nonregular files, lock contention and invalid boot identities. A simple
directory-barrier restart model tests both visible-but-uncommitted state and
committed state after a reported failure. It is a model of application ordering,
not an emulation of the PS5 filesystem or proof of actual power-loss behavior.

One regression test failed on the prior implementation: after a package rename
succeeded but the directory sync failed, a retry accepted the matching visible
file without completing the directory barrier. The next modeled restart lost
that supposedly saved package. Retrying an existing verified package now syncs
the file and directory before success. Directory close failures also propagate.
Nonblocking opens allow the type checks to reject FIFOs instead of waiting for a
writer. All success/failure tests check that descriptors are released.

Phone Components and controller Preferences now share explicit retained-package
removal. The inventory inspects at most 128 matching package headers per refresh;
this is not payload verification and does not imply a trusted publisher. The
native removal command holds the same selection lock as staging/launch, rereads
selection, checks the expected revision and refuses all four retained roles:
good, previous, candidate and attempt. It validates the exact hash-named regular
package and removes only that path, then syncs the directory. An already absent,
otherwise eligible path can complete that barrier on retry. Corrupt selection,
stale revisions, protected packages and invalid file types remain untouched.

The shared API additionally blocks removal during unfinished staging. Controller
and phone actions require confirmation. Existing uploads, interrupted staging
files and selection records are retained. This is deliberately explicit package
retirement, not automatic cleanup or a solution for damaged private files.

All **297 local tests** pass (`.local/checkpoint28-tests.txt`). The new native tests
exercise the actual I/O functions and retirement protections. Shared-runtime tests
cover all retained roles, stale/corrupt requests, queued staging and controller
confirmation, and verify uploaded sources/unrelated files survive removal. The
embedded QuickJS checks pass. All five rebuilt ELFs pass native image inspection
and the machine-code process-lookup regression (including its negative fixture).
The three update C sources pass `-Wall -Wextra -Werror` against the target SDK with
SDK/QuickJS headers classified as external; vendor inline unused-parameter
warnings were excluded without weakening warnings for TacHen sources.

The actual 390-pixel loopback browser rendered protected and unused fixture
packages, opened the confirmation and verified Back preserved the list. The
preview deliberately disabled final native deletion; host tests cover removal.
After fixing narrow-row wrapping, `.local/update-retained-phone.png` captures the
final phone view. Browser console warnings/errors were empty. Its tab and both
preview-server instances were closed and the viewport override reset.

Runtime **9,006,216 bytes**, SHA-256
`ed120031ed6034b75b75b1d501792a99de4274fab3f1ed75797080e07662be45`.
Launcher **9,135,168 bytes**, SHA-256
`38cf54f6e1b96fb38438e26d7ad3b97b6b1905ec51c4c1a88da61ecf64ab4d7d`.
Update package **9,006,472 bytes**, SHA-256
`6b4390b5a0a0e34aecad0b454a3d5cc396318f18696b394da31f207506855502`.
Source fingerprint
`a9bb740555e8f688f298d7c2333fd148b7ad276be8c1eea1882acdee1fc4de0e`.

No PS5 was contacted and nothing was published or deployed. Overall completion
remains unproven. The full goal stays active: original native presentation and
control coverage, remaining cheat formats, save recovery, older-firmware package
installer ABI coverage and deferred console acceptance still need work.


## Checkpoint twenty-nine - shared controller plugin controls and current embedded binaries

Payloads -> Plugins now supports registering verified inbox containers, selecting
system/game scope, manual loading and optional autostart. Exact game/version
choices come from the running game and saved loadouts, including when no game is
running. Registration does not execute code. Confirmations precede registration,
manual loading and enabling autostart. Circle steps back through nested views;
section changes clear that view. The wire remains version four with six pages.

Phone and controller share start availability, exact module platform/game/version
matching, pending-operation and startup-recovery holds, and residency explanations.
Snapshot rendering does not query native process state. Autostart may be armed
before opening a game. Disabling it does not terminate code or undo patches; this
change does not supply a generic plugin unload operation.

The new controller tests drive real shared runtime commands with a mocked native
boundary: system registration/start before a game, duplicate confirmation, stale
phone/controller configuration revisions, module target/version holds, deferred
autostart, saved-loadout targets, and safe-recovery holds. They prove coordinator
behavior, not execution or plugin compatibility on PS5. The 390-pixel local phone
preview used fixture plugin data; `.local/plugins-phone-controls.png` records it.
Its server and browser tab were closed after inspection.

**Correction to earlier artifact validation:** final embedding inspection found
that Zig could reuse stale assembly objects for unchanged `.incbin` paths, even
though the binary at that path had rebuilt. The launcher contained an earlier
runtime package, and the runtime contained old deck/save helpers. Earlier checks
validated each standalone ELF, not those nested bytes; those checks did not prove
that earlier launchers carried the latest code. None was deployed or published.

Generated assembly now includes each current content digest outside the exported
asset span, after helpers have linked. The build verifies exact byte equality at
the start/end symbols with a unique file-backed load mapping before accepting the
runtime or launcher. Manifest entries record the checked spans. The verifier
rejected the prior launcher before the build fix. A real Zig incremental regression
changes asset contents at the same path, size and timestamp, verifies the new
bytes, and checks a repeat build is identical. Negative cases reject stale bytes,
a matching copy elsewhere in the file, wrong spans, missing symbols, truncation
and non-file-backed mappings. Tests also verify every final embed recursively
through the launcher's package to the current runtime and its four assets.

All **305 local tests** pass (`.local/checkpoint29-tests.txt`), including native
image/process-link checks and the new embedding regressions. Embedded QuickJS
checks pass. Hardware testing remains deferred. Current artifacts:

Runtime **9,006,216 bytes**, SHA-256
`bbe7d8c3014f3e0065b79a13bac1d64142d1e8ee5ada92b7259b74e78ff23f22`.
Launcher **9,167,936 bytes**, SHA-256
`7cc880791b95b2fd153721bc045d269cbc6435f23e53207a1e42f825facc6522`.
Update package **9,006,472 bytes**, SHA-256
`e10aeef712d40d38f33bb88a1f42061ea8f46e87b14f946f98cd041378a2b4cd`.
Source fingerprint
`fc5bbc6faaf964045f25f86e9af2a6ddda6a908b70ed5e64c759cbd918db1348`.

No console was contacted and nothing was released. Remaining scope includes the
original console presentation, broader cheat formats, save interruption recovery,
older-firmware package installer ABI coverage, further developer scanning and
plugin lifecycle work, and all deferred console acceptance. The full goal remains
active; local checks do not establish console stability.


## Checkpoint thirty - native focus layout and nested Home navigation

The native renderer now uses an original three-area text arrangement: section
rail, action list with enabled/on state, and a focused title/explanation. The
presentation is generated by production `deck-layout.c`; the PUI adapter applies
that same layout using its existing validated label/font/color calls. Forty-five
bounded labels and five font/color styles replace the earlier 23-label list.
Labels wrap on word and UTF-8 boundaries, with conservative wide-character cell
counting and ellipses for bounded headings. The focused pane retains the full
160-byte detail received on the wire across six lines. Metrics/IP and temporary
notices are independent of the action area.

A discovered navigation bug let Circle close the whole deck from a confirmation
or startup review on Home. Frames now explicitly indicate a nested back action.
Wire version five retains the 6,424-byte size but adds that flag; old-version
frames are rejected rather than silently applying the new navigation semantics.
The native controller test checks nested-back and root-close behavior, and the
shared-runtime test verifies confirmation cancellation updates that flag.

The renderer caches the last painted layout. Unchanged frames do not mutate
managed objects; a metric-only change updates only that text. Scene replacement
clears the cache, removes old labels and renders current state into the new root.
A managed rendering exception clears/releases the labels, returns failure and
keeps input ownership from treating that view as ready. Tests compile production
`deck-view.c` against a managed-object boundary fixture and exercise those paths.
They do not validate the PS5 Mono ABI or emulate PUI itself.

The local preview compiles the actual C layout and renders its output as SVG with
browser fonts. Enabled, unavailable and closed-deck views were inspected. The
closed view retained only opted-in example metrics/IP and the current notice.
Browser warning/error logs were empty. `.local/native-deck-focus.png` records the
unavailable-action view. Both temporary preview processes and the tab were closed;
no viewport override was applied.

**Visual scope remains incomplete:** the preview's dark background is a browser
matte, not a newly implemented console backplate. Native background/compositing,
contrast over real games, final visual design, actual font metrics and hardware
navigation remain outstanding. No unverified panel APIs or guessed UI offsets
were introduced, and this checkpoint does not call the custom console UI complete.

All **311 local tests** pass (`.local/checkpoint30-tests.txt`), as do the embedded
QuickJS checks, current embedded-asset equality checks, native image validation
and process-link regression. Current artifacts:

Runtime **9,006,216 bytes**, SHA-256
`4c90d0b8c452c2e42fb45f92ae62789f4b81f576a2b249a45aff152df283fd76`.
Launcher **9,167,936 bytes**, SHA-256
`e41b908181c97a0170866bac5d9ef49a6e997fa21dfab59016b9573edf0804ad`.
Update package **9,006,472 bytes**, SHA-256
`7df00b5ef183b86c913986d4a529562de975eb411afff8f527ab140cb4de3fd3`.
Source fingerprint
`535ddc861ad0da911d208ad76237177cad70cc1bcac89efadfa94e6aaf7053ae`.

No console was contacted, rebooted or tested. Nothing was released or deployed.
The user reiterated that all implementation comes first and console testing last.
The full goal remains active with the remaining requirements in checkpoint 29,
including the visual/compositing work described above.


## Checkpoint 31 — interrupted save publication recovery

Activity's Check result now starts an explicit, bounded-state native background
check for interrupted save catalog/export jobs. The worker claims the existing
save lock and native-operation gate, binds the exact active request and receipt
checksum, and proves the original helper cannot still execute. A changed, valid
boot identity is sufficient; on the same boot it requires a recorded PID proven
absent. Missing PID, an ambiguous process result or an unreadable boot identity
remains held. An old heartbeat or an available lock alone is not proof.

The worker then verifies private staging has no foreign filesystem/mount. It
never unmounts, recopies or removes staged files. Published archives require the
expected path/size/checksum, full byte hashing, unchanged file and destination
identities and storage barriers. USB identity is checked before and after the
operation, including absent-directory outcomes. Receipt changes prevent commit.
If publication is absent and the process/mount checks pass, the operation settles
as failed with an explicit retained-staging message, releasing its queue resource.
A verified publication instead settles as completed. An existing archive without
matching evidence remains held. Interrupted catalog files without a recorded
checksum are retained and cannot be claimed as completed.

Parent directory creation now has a persistence barrier before child publication.
Concurrent controller/phone checks coalesce, polling occurs only after an explicit
check, and the queue remains locked while hashing. A failed check stops polling
and permits another explicit check after the cause is resolved. Closing the
runtime stops the observer; it does not pretend to cancel an active native worker.

Production C recovery code is exercised with a path-aware syscall boundary
fixture: live/missing/unknown helpers, boot errors, held locks, mounted/foreign
staging, symlinks, missing/corrupt/swapped files, receipt races, swapped destination
directories, USB loss, commit/sync/close failures, and descriptor cleanup. This
verifies logic and failure propagation, not PS5 filesystem or process semantics.
Shared-runtime tests verify explicit initiation, duplicate checks, queue blocking,
background completion, retained staging, malformed/failed evidence, receipt binding,
and the controller Activity action.

All **317 local tests** passed (`.local/checkpoint31-tests.txt`), along with the
QuickJS runtime checks, native build, embedded-image equality checks and all five
process-link audits. No PS5 was contacted. Nothing was deployed or released.

Remaining save scope: verified private archives are not automatically republished
or resumed; retained staging has no user cleanup control yet. Console acceptance
for PFS/decryption, directory fsync, PID/boot evidence and USB removal stays last.
This checkpoint does not complete the full TacHen goal; other remaining feature
and presentation requirements from checkpoints 29–30 still apply.

Runtime **9,023,192 bytes**, SHA-256 `ee4b4564dacadf83469a9f07bfcc4c3c996255da545d6e0ea147caa90a36437c`.
Launcher **9,184,320 bytes**, SHA-256 `91cdefbf3a6ecab4a36d1f707c1ab2ffe234be768c0d1cc161d97a1b37f20c7c`.
Update package **9,023,448 bytes**, SHA-256 `9e23cae68c8d0bd1c17dc1e32db31978c3df76023d2f9f276bdc47d5a015477e`.
Source fingerprint `e13a94e1cfeba1970ae72cc44bb16abc87a19ef2fcebad01eed82c1de1a4cca0`.


## Checkpoint 32 — SHN/XML cheat import

The phone's existing file importer now accepts unencrypted SHN/XML as well as
JSON. Both normalize into the same checksummed persistent pack, with the same
exact title/version binding, preserved author credits and native before-byte/
rollback transaction. Equivalent inputs deduplicate to the same pack identity;
import alone never applies a cheat. Native section-zero scope is unchanged.

The original bounded reader supports the public Trainer/Cheat/Cheatline fields,
byte pairs with optional hyphens, comments, CDATA, numeric/predefined entities,
UTF-8 declarations and complete aligned legacy PKCS#7 suffixes. It rejects DTDs,
custom/external entities, processing instructions, duplicate fields/attributes,
unknown structural content, malformed bytes, oversized fields/depth/node counts,
and identity conflicts. Nonempty Absolute fields retain etaHEN's meaning and
are rejected by the unimplemented absolute-address adapter, even if their text
is 'false'; they cannot silently become relative patches.

Format evidence: etaHEN's local public ParseXMLCheat implementation and GoldHEN
Cheat Repository commit `acc22fefac0f0ea35a0f59b3f9526707122098dd`,
`shn/CUSA00002_01.00.shn` and `shn/CUSA00002_01.81.shn`. Local imports recovered
3 and 7 cheats respectively, retaining Talixme and Celogamez credits. Public
sample bytes/provenance are under `.local/cheat-format-review/`, not distributed
with TacHen. Regression fixtures contain original synthetic bytes, not those
game patches. NOTICE.md records the format sources and credits.

All **323 local tests** pass (`.local/checkpoint32-tests.txt`), including parser
limits, malformed/ambiguous XML, both-direction packet equality, persistent
deduplication and rejected imports without storage/native effects. QuickJS
executes the importer as part of its portable-runtime checks. The production
ELF build and exact embedded-asset checks pass.

Browser verification used the production local phone page and a synthetic SHN
file: upload succeeded, credits appeared, and both apply/restore buttons remained
disabled without a matching game. Browser warning/error logs were empty.
`.local/shn-import-preview.png` records the result. The preview tab and loopback
server were closed; no viewport override was used. No console was contacted.

Remaining cheat compatibility includes nonzero native sections, absolute/code-cave
semantics, encrypted MC4 and binary formats. Real-game/hardware acceptance is
deferred until the implementation is finished. Other outstanding full-goal work
remains active; this is a local checkpoint, not a release.

Runtime **9,023,192 bytes**, SHA-256 `d93b504725c1076b26f87ca23d41142ae52bdbaf9a7f3824336ca47a1aa2ee3e`.
Launcher **9,184,320 bytes**, SHA-256 `6d6b9d30c60939dc4ba99a61fd6cbd0dbb9cb44053d44463f703e5c82b0f1373`.
Update package **9,023,448 bytes**, SHA-256 `ab6e0cd94994be07821d0e2bd7d3ae4620485e5e46c9009a4c9c77d1f7093ad2`.
Source fingerprint `6207e092273d6aeb78baaaa120c563df2da9cb7c5d5676fc40743c240c29c653`.


## Checkpoint 33 — MCP candidate refinement

Known-pattern scans retain observed bytes for each of at most 8,192 matches in
private session RAM. The bounded eight-result cache and five-minute access expiry
remain. Candidate bytes are not returned through snapshots or saved in durable
job records. An explicit `memory_refine` tool queues the normal `memory.inspect`
job with an exact source-result identity and the existing developer grant.

Comparisons include changed/unchanged raw bytes, equal/different same-width
hex/wildcard patterns and explicit little-endian increased/decreased numeric
comparisons. Supported numeric widths are signed/unsigned 8/16/32/64-bit and
32/64-bit floating point. Integer comparison preserves full 64-bit precision;
nonfinite floating values do not match numeric comparisons. Successful passes
create independent new baselines, leaving the source result unchanged.

Sorted candidates are grouped into read windows of at most 64 KiB, checking each
full candidate even across a previous chunk boundary. Reads use the existing
verified stopped-game/native-receipt path. The worker rejects changed module
base/extent or game identity, expired sources and ended access grants. It holds
unconfirmed native resume and permits cancellation only after a confirmed read
settles. No partial result is published. Empty candidate sets need no new native
read. Truncated input remains explicitly truncated after every refinement.
The tool does not enumerate heap regions, start unknown-value scans, write memory
or change the developer write gate. Those broader scanning requirements remain.

All **332 local tests** pass (`.local/checkpoint33-tests.txt`), including batching,
wildcard-byte baselines, successive passes, signed/64-bit comparison, numeric
width rejection, partial coverage, source/module/game changes, revocation,
expiry, cancellation and unconfirmed resume. A real local HTTP MCP session
checks tool dispatch, deduplication, result access and revocation without a write
grant. QuickJS executes refinement and 64-bit comparison; the native build and
current embedded-image checks pass. The native reader itself is unchanged.

No console was contacted, tested or rebooted. No artifacts were deployed or
released. Full implementation continues; remaining hardware validation stays
last as requested. Earlier outstanding feature/UI/firmware integration work is
not waived by this checkpoint.

Runtime **9,039,576 bytes**, SHA-256 `b5d4f85ae1bbb0bb1aafbab9a60f8ff6f3ff3ff30ec44cda5ba6103427cf8f78`.
Launcher **9,200,704 bytes**, SHA-256 `f35bd00d35f8c491a755f1a9b7162d769092dfa624c1213c9c8c9e4225723728`.
Update package **9,039,832 bytes**, SHA-256 `f6fe6e8b1f717330d4d8857c76ad01b9b7b3ed2398f385273ef03049603d77b2`.
Source fingerprint `c77e99e250cbf8e2b4d56f5c60fd644f701bf3d3a38bf36d4d00110942eae5e9`.


## Checkpoint 34 — durable terminal-job archive

The job queue now moves eligible older terminal jobs out of the active snapshot
in batches of at most 64 when it reaches 768 records or 2 MiB of job data. It
retains the newest 256 jobs, unresolved work, executing/reconciling transitions,
unknown job kinds, native residency/once-per-boot guards, reversible operations,
referenced receipts and each package's latest successful verification. This
reduces routine scan/export/transfer history pressure without erasing ownership
or removing evidence needed for supported undo.

Sixty-four lazily created archive groups each have three reusable slots and a
4 MiB / 8,192-record per-slot bound. Checksummed slot references live in the two
state snapshots. Writes preserve both current and previous state roots; failed
archive or state commits do not publish removal. Serialized reads prevent slot
reuse during receipt lookup. Missing, changed or malformed referenced archives
fail closed for their request group, including previously unseen keys, instead
of treating lost evidence as permission to replay work. Space remains bounded;
protected-only state and full archive groups can still refuse new work. This is
not a generic purge or an infinite history guarantee.

Exact-key retries consult durable archives before live validation. Archived
results retain their original identity/outcome, and mismatched key reuse is
rejected. MCP operation-status reads retrieve an archived result by ID while
omitting private intent/checkpoint fields. Ordinary runtime snapshots report
only the archived count; archive contents are not sent on every phone refresh.
Original source/output files and native receipts are not removed.

All **340 local tests** pass (`.local/checkpoint34-tests.txt`). Archive tests cover
restart/deduplication, protected/reference retention, missing/changed receipts,
failed main commits, both-state fallback, repeated three-slot reuse, serialized
reads and protected-only capacity. QuickJS executes real archive serialization,
hashing and lookup; the production build and embedded-image checks pass
(`.local/checkpoint34-build.txt`). No console was contacted and no build was
published or deployed.

The accompanying `PACKAGE-ABI-REVIEW.md` records the pinned public-source review.
Those sources do not establish lower-firmware AppInstUtil structure layouts;
the existing 13.60 native-installer guard remains. This is an outstanding full-
goal integration, not a claimed firmware test or a removed requirement. Other
outstanding native presentation/integration and final console acceptance work
remains active.

Runtime **9,039,576 bytes**, SHA-256 `b5085a892b8f967eaecf448e2fc55729be3a2f91ddcf45a3e0347df0bb824185`.
Launcher **9,200,704 bytes**, SHA-256 `df4b4261b697ea24d9e1afd6f9a8c090f121118a2674d6ca4cb6a7211da63496`.
Update package **9,039,832 bytes**, SHA-256 `ae3f9f04a3e3c462099d562329b90447e383e77e1a7fd17ccb48ea34183b7c90`.
Source fingerprint `dee0ae0075360038fd26fbbeddbe817e43bb8a9721f72f31c4fbf3caf0bd995b`.
