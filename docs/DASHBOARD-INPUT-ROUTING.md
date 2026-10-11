# Dashboard input routing tester

The reported 13.60 run reached bootstrap state 4, render phase 4, input phase 2,
and input ready 1. Every sample retained route 2 and open 0. In that code,
route 2 unconditionally bypassed the dashboard shortcut. It means the game
bridge is unavailable or awaiting verification; it does not prove a game owns
the foreground. The pasted source identity was df42dd2123a56c8e8027c22a5175fc688b254676dba02eccb52b76823a4bc920.

This tester resolves the static, zero-argument Boolean method
`LayerManager.IsGameLayerFullScreenFocused` from the console's AppSystem
metadata. Its signature exists in the locally inspected 13.60 metadata. The
renderer reads it on the UI thread. Controller and network callbacks do not
invoke managed methods to determine focus.

Verified ShellUI foreground uses the dashboard input route independently of
game detection, game metadata, bridge preparation and bridge capture epochs.
Game bridge resets cannot close that dashboard menu or reset its shortcut hold.
When the game takes full-screen focus, dashboard ownership is released and the
existing game capture acknowledgement is required. Stale game batches are not
replayed on a focus transition. A failed focus call leaves game capture held;
an absent/incompatible method retains the previous routing behavior without
rejecting menu injection.

New runtime fields: focus 0 means ShellUI, 1 means full-screen game, -1 means
lookup failed, -2 means the method was unavailable. requestedRoute is the
coordinator's route; route is the effective resident route. A dashboard with
requestedRoute 2 and route 0 is the intended recovery in this report.

The controller engine tests cover shortcut opening with an unavailable bridge,
bridge epoch changes during the hold and while open, release on game focus,
preserved game capture requirements, failed focus calls and unavailable methods.
These are local regression tests, not console confirmation of the new behavior.

Reboot and jailbreak before loading the replacement resident ELF. At the
dashboard, hold L3 + R3, release, navigate, then close with Circle. Repeat with
a game left running in the background. If it still does not open, preserve
`/data/tachen/runtime.log`; the new fields distinguish focus detection from
bridge and renderer failures. Do not reload the resident ELF in the same boot.
