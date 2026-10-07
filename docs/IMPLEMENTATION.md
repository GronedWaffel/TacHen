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
