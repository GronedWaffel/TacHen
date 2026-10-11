# TacHen

**Beta 1 — PS5 firmware 11.00–13.60, excluding 11.40.**

TacHen brings a native controller menu and a console-hosted web interface with layouts for both phones and PCs together for payloads, packages, games, plugins, cheats, saves and file transfers.

## Download and start

1. Download **TacHen.elf** from [Releases](https://github.com/GronedWaffel/TacHen/releases/latest).
2. Reboot and jailbreak your PS5. Send the ELF with your payload sender or load it through your existing payload loader.
3. Wait for the startup notification, then hold **L3 + R3** to open TacHen. **Circle** goes back; L3 + R3 closes the menu.
4. For the web interface, open **http://YOUR-PS5-IP:8780** in your phone or PC browser on the same network. The layout automatically adapts to the screen: a mobile layout on phones and a desktop layout on PCs.

TacHen is a post-jailbreak payload, not an exploit. Use a fresh boot when replacing an already-running TacHen build. This release ELF selects its bundled runtime so an older saved update cannot replace the build you just downloaded.

## Features

- **Payloads:** download from a direct link, manage Downloads, load an ELF from console storage or USB, and set startup order/delays. Selecting an ELF in storage checks and loads it without extra confirmation screens.
- **Packages:** install directly from USB or console storage, manage downloaded packages, and receive packages through DPI v2. Local packages are read from their source rather than copied to the internal drive first. Keep the source drive connected until installation finishes.
- **Games:** browse installed and ShadowMount games, launch, mount and unmount, with automatic status refresh.
- **Plugins:** import and register `.plugin` and `.prx` modules for the intended game/version. It is recommended to start plugins only after you are in the game. Module compatibility depends on the plugin and exact game build.
- **Cheats:** import supported JSON, SHN/XML and MC4 files, or download the etaHEN/GoldHEN catalogs. Opening Cheats selects a matching pack for the running title and version; otherwise it opens the normal library. Cheats are enabled individually, never automatically by opening the page.
- **Saved games:** browse saves and export backups to USB or the FTP share.
- **Transfers:** view progress and use a two-pane file browser to copy files and folders between console storage and USB.
- **Display:** FPS and other game telemetry, optional IP display, dashboard title IDs and game versions, plus the dashboard Cheats action.
- **Phone, PC and tools:** a console-hosted website with mobile and desktop layouts, FTP share, and the MCP interface for compatible tools.

The built-in FTP share is on **port 2122**, rooted at `/data/tachen/share`; use `tachen` or `anonymous` with any password on your trusted local network. DPI v2 uses **port 12800** when enabled in Packages.

## Firmware and beta status

Supported profiles: **11.00, 11.20, 11.60, 12.00, 12.02, 12.20, 12.40, 12.60, 12.70, 13.00, 13.20, 13.40, 13.42 and 13.60**. **11.40 is not supported.**

**No known issues reported by testers at release time.** This is a community-tested beta; that report does not mean every firmware, game and third-party plugin combination has been tested. The release includes 555 passing automated tests. Please include firmware, game/version and reproduction steps when reporting a problem. Support capture is described in [the diagnostics guide](docs/SUPPORT-CAPTURES.md).

## Build and source

TacHen is GPL-3.0-or-later. Source is available in this repository and in the release source archive. See [BUILDING.md](BUILDING.md) for toolchain and dependency inputs. Release assets include checksums, build metadata and a third-party source bundle. Historical engineering notes live in [docs/DEVELOPMENT-NOTES.md](docs/DEVELOPMENT-NOTES.md).

## Credits

Thanks to the community testers and the authors whose work makes this possible: John Törnblom and the PS5 Payload SDK/libelfldr/libNineS contributors; LightningMods, etaHEN and OnionHEN contributors; EchoStretch and the kstuff contributors; Drakmor and ShadowMountPlus contributors; PLK and Payload Manager contributors; GoldHEN and cheat authors; ciss84; and the authors of the bundled open-source libraries.

TacHen's menu and workflows are its own; bundled components and adapted code retain their original authorship and licenses. See [NOTICE.md](NOTICE.md) for detailed attribution and provenance.
