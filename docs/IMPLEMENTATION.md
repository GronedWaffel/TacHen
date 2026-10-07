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
