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

1. Native asynchronous ELF execution adapter with process identity receipts,
   originally from John Törnblom's loader as used by the tested etaHEN port. Preserve
   controller-startup fixes in later ShellUI integration. Do not call sent/spawned ready.
2. FTP-to-inbox/catalog bridge and phone upload resumption controls; library storage
   adapters for console and USB, replacing the development share's limited scope.
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
