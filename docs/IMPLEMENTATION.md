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
