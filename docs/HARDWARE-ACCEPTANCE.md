# Deferred console acceptance

**Status: not run.** These are instructions for the final attended test phase,
not recorded results or permission to contact a console while the owner is away.
A local review ZIP, green host tests or a source fingerprint does not establish
that TacHen works on hardware.

## Record each attempt

Keep the review archive name, source commit, `build-manifest.json`, launcher and
runtime hashes, exact firmware, starting jailbreak/services, game title/version,
selected settings and the observed outcome. Record failures before retrying. If
support evidence is needed, enable it beforehand and preserve the report before
a restart when possible. Never put credentials, raw private logs or account data
in a public issue. Follow SUPPORT-CAPTURES.md for what the recorder can capture.

Only the owner or an explicitly authorized tester should perform these steps.
Use owned offline games and expendable test files. Do not deliberately cause a
kernel panic, cut power during writes, delete existing HEN settings or uninstall
working applications to manufacture a recovery case.

## Ordered acceptance sequence

1. **Preflight and one startup.** Start on the owner's 13.60 console after its
   usual jailbreak, with the owner present. Record existing kstuff, ShadowMount,
   Payload Manager and etaHEN processes. Review conflicts before launching; do
   not silently stack a second ShellUI renderer over another HEN. Load only
   `tachen.elf` once. Check the startup receipt, ordered service readiness and
   phone availability. A notification alone is not success. Unknown/held work
   must remain held instead of dispatching a duplicate.
2. **Native command deck.** Check dashboard opening/closing, all six sections,
   focus text and unavailable reasons. Verify nested Circle returns and root
   Circle closes. Change each accent and the IP toggle. Then test startup while
   moving controls, the earlier etaHEN failure trigger, as a separate recorded
   attempt. Do not proceed through a system-software error as a pass.
3. **Phone and shared state.** Open the console's displayed LAN address on a
   phone. Make settings changes from phone and controller; check they agree.
   Use two phone sessions to confirm stale changes fail visibly. Close/reopen a
   page, disconnect a device and confirm its old session can no longer act.
4. **FTP and payload inbox.** Upload a small known benign test ELF through both
   phone and FTP port 2122. Check sizes and hashes, resumable phone transfer,
   cancellation, incomplete-file visibility and verified inbox registration.
   Dispatch the benign test once and check its actual notification or output.
   Repeat the same request and confirm that it does not launch twice. The FTP
   root is `/data/tachen/share`; the URL does not expose all console storage.
5. **Packages.** On 13.60, stage and verify a small owned test PKG, review its
   content identity and install once. Verify real progress and the installed
   content/version, not merely installer acceptance. Check held/duplicate
   requests without submitting another installation. Repeat on other exact
   supported profiles through authorized testers: verify the common status
   prefix gives real byte progress and error/terminal states, and independently
   check installed content/version. Numeric status-tail error details are only
   interpreted on 13.60. Cross-build and synthetic layout fixtures do not pass
   installation acceptance for any firmware.
6. **ShadowMount and managed files.** With the game closed, refresh the library,
   mount one known working image and check actual mounted state. Unmount after
   closing the game. Copy/extract a disposable image to a separate destination;
   verify bytes, space reporting, progress and cancellation behavior. Preserve
   the source. Check that an active game blocks conflicting mount changes.
7. **Plugin formats and lifecycle.** First use a known benign `.plugin` test
   process, manually and through autostart. Confirm actual behavior, not just
   process presence. Test before game start, exact target/version selection,
   game exit and reopening. Then use a compatible benign `.prx`/`.sprx` against
   its exact game/API. Disable autostart and confirm it prevents future loads;
   it must not claim to unload already resident code or reverse its patches.
8. **Games, overlays and input.** Test at least one PS4 and one PS5 game, recording
   title/version and process changes. Open the deck in-game, verify that input
   is consumed while open and returned afterward, then repeat after game exit.
   Enable FPS and resources separately before combining them. Confirm live
   readings, no sticky input, no ShellUI error, stable frame pacing and that
   opt-outs stop the intended sampling/display work.
9. **Cheats and loadouts.** Start with a known reversible data-only test against
   an exact game build. Check title/version mismatch rejection, before-byte
   mismatch rejection and successful On/Off. Verify session-history reversal
   for an equal-length patch. Unequal-length patches must show their limitation:
   authored Off bytes can leave extra On bytes, and exact history undo must be
   unavailable. Nonzero-section and missing-code-cave cases remain unsupported.
   Test a saved loadout on the next game instance and confirm missing
   dependencies or changed versions block it rather than partially applying it.
10. **Save export.** Close the selected game. Export an owned PS4 save and an
    owned PS5 save to the FTP share and to a disposable USB destination. Compare
    archive checksums and inspect decrypted contents locally. Confirm the
    original save and its metadata remain unchanged. A completed upload or a
    created folder alone is not export success. Test supported cleanup only on
    the new export; do not delete original console saves.
11. **Developer MCP.** Enable it explicitly and connect a real client. Verify
    title/module lookup, bounded reads, scans, refinement, cancellation and
    truncation reporting. Revoke the grant during a scan and confirm further
    chunks stop. Writes stay disabled by default and reset on startup. If write
    testing is approved, use the already verified imported cheat; raw arbitrary
    writes are not exposed by this MCP interface.
12. **Activity, history and diagnostics.** Check errors and unfinished operations
    from the preceding tests, legitimate supported undo, duplicate commands,
    notice grouping/dismissal and shared state. With support recording enabled,
    download a report and check run boundaries, firmware/build identity and
    redaction. Disable recording and confirm ordinary use remains functional.
13. **Normal restart and update recovery.** Preserve evidence first. Use normal
    attended restarts to check recovery mode, non-replay of interrupted work and
    known-good configuration. Establish one verified launcher build before
    staging another trusted local package. Test next-boot trial promotion,
    cancelling a selection and returning to a previous verified build. A
    forced crash or intentional interrupted disk write is not required here;
    those faults are exercised by local injection tests.
14. **Repeated and combined use.** Repeat cold starts and game transitions, then
    combine a phone transfer, normal library use, overlays and controller
    navigation. Record idle and active resource use and every failure. Do not
    report a success streak as proof that crashes are impossible or that other
    firmware versions passed.

## Firmware and completion boundaries

Exact targets are 11.00, 11.20, 11.60, 12.00, 12.02, 12.20, 12.40, 12.60, 12.70,
13.00, 13.20, 13.40, 13.42 and 13.60. Firmware 11.40 and versions below 11.00 are
excluded. Do not upgrade or downgrade the owner's console for this checklist.
Other target profiles need their own evidence from authorized testers. Shared
source and offsets do not substitute for those results.

Before release, validate the shared native installer contract on the target
profiles and verify every promised workflow. Advanced section addressing and
code-cave cheats are outside the revised scope. Separate unsupported input from
an execution failure. Retain truthful
per-firmware/per-feature results and original component credits. A feature marked
unavailable is not counted as completed support. Current binaries remain
unverified development artifacts; this document records no successful console
attempts.
