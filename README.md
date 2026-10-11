# TacHen

**Beta 3 — Havana compatibility update; 67 exact PS5 firmware profiles from 1.00 to 13.60, including 11.40.**

The original **Beta 1 ELF remains available unchanged**. The separate compatibility ELF adds public offset tables; the added firmware support is **untested on hardware**. Firmware below 11.00 is theoretical compatibility, not a confirmed working claim.

TacHen brings a native controller menu and a console-hosted web interface with layouts for both phones and PCs together for payloads, packages, games, plugins, cheats, saves and file transfers.

## Download and start

1. Download from [Releases](https://github.com/GronedWaffel/TacHen/releases/latest): **TacHen-compatibility.elf** for the expanded firmware preview, or **TacHen.elf** for the unchanged original Beta 1 (11.00–13.60, excluding 11.40). Choose one ELF.

2. Reboot and jailbreak your PS5. Send the ELF with your payload sender or load it through your existing payload loader.

3. Wait for the startup notification, then hold **L3 + R3** to open TacHen. **Circle** goes back; L3 + R3 closes the menu.

4. For the web interface, open **http://YOUR-PS5-IP:8780** in your phone or PC browser on the same network. The layout automatically adapts to the screen: a mobile layout on phones and a desktop layout on PCs.

TacHen is a post-jailbreak payload, not an exploit. Use a fresh boot when replacing an already-running TacHen build. This release ELF selects its bundled runtime so an older saved update cannot replace the build you just downloaded.

## Havana plugin compatibility

Beta 3 adds support for the official Havana 1.2 `rdr3Payload_132.sprx` on RDR2 update **1.32**. A community tester reported it working without errors on **PS5 13.42**. Download **TacHen-compatibility.elf** for this fix; the preserved original `TacHen.elf` does not include it.

After a fresh boot and jailbreak, load TacHen, enter RDR2 Story Mode, then load Havana manually. Open Havana with **R1 + Square**. The adapter supplies the process-info and memory operations this exact plugin uses and installs its game hook in one complete write. It does not establish compatibility with every GoldHEN plugin, other Havana releases, or every firmware. See [the plugin compatibility notes](docs/PRX-CONTAINER-COMPATIBILITY.md).

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

The compatibility ELF recognizes these exact versions; versions between listed entries are not implied:

- **1.xx:** 1.00, 1.01, 1.02, 1.05, 1.10, 1.11, 1.12, 1.13, 1.14.
- **2.xx:** 2.00, 2.20, 2.25, 2.26, 2.30, 2.50, 2.70.
- **3.xx:** 3.00, 3.10, 3.20, 3.21.
- **4.xx:** 4.00, 4.02, 4.03, 4.50, 4.51.
- **5.xx:** 5.00, 5.02, 5.10, 5.50.
- **6.xx:** 6.00, 6.02, 6.50.
- **7.xx:** 7.00, 7.01, 7.20, 7.40, 7.60, 7.61.
- **8.xx:** 8.00, 8.20, 8.40, 8.60.
- **9.xx:** 9.00, 9.05, 9.20, 9.40, 9.60.
- **10.xx:** 10.00, 10.01, 10.20, 10.40, 10.60.
- **11.xx:** 11.00, 11.20, 11.40, 11.60.
- **12.xx:** 12.00, 12.02, 12.20, 12.40, 12.60, 12.70.
- **13.xx:** 13.00, 13.20, 13.40, 13.42, 13.60.

**Testing status:** the 53 added profiles, including **11.40** and every listed firmware **below 11.00**, have not been hardware-tested with TacHen. Their public tables cover the required offsets and have been checked against pinned upstream sources. They should theoretically work, but that is not a guarantee that startup, the menu, plugins, packages, saves or every bundled component works on each version. No 14.00+ profile is included.

The original Beta 1 targeted 14 profiles on 11.00–13.60 excluding 11.40. Testers reported no known issues at its release; this was not an exhaustive per-firmware, game or plugin test matrix. **That report does not apply to the new compatibility build.** Original offsets and the published Beta 1 ELF are unchanged.

Compatibility builds keep their update selection in `/data/tachen/updates-compatibility`, separate from Beta 1's `/data/tachen/updates`. Both use the same normal settings and library. Reboot before switching ELFs; do not try to run both at once. Neither ELF performs a jailbreak or creates an exploit entry point for a firmware.

Please report the exact firmware, ELF/build identity, feature, game/version and reproduction steps. Capture instructions are in [the diagnostics guide](docs/SUPPORT-CAPTURES.md). The [firmware notes](docs/FIRMWARE-COMPATIBILITY.md) explain the sources, validation and limitations.


## Build and source

TacHen is GPL-3.0-or-later. Source is available in this repository and in the release source archive. See [BUILDING.md](BUILDING.md) for toolchain and dependency inputs. Release assets include checksums, build metadata and a third-party source bundle. Historical engineering notes live in [docs/DEVELOPMENT-NOTES.md](docs/DEVELOPMENT-NOTES.md).

## Credits

Thanks to the community testers and the authors whose work makes this possible: John Törnblom and the PS5 Payload SDK/libelfldr/libNineS contributors; LightningMods, etaHEN and OnionHEN contributors; EchoStretch and the kstuff contributors; Drakmor and ShadowMountPlus contributors; PLK and Payload Manager contributors; GoldHEN and cheat authors; ciss84; and the authors of the bundled open-source libraries.

TacHen's menu and workflows are its own; bundled components and adapted code retain their original authorship and licenses. See [NOTICE.md](NOTICE.md) for detailed attribution and provenance.
