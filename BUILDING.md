# Building TacHen compatibility preview

Toolchain used: Windows x64, Node.js 24, Zig 0.14.1, and [PS5 Payload SDK v0.43](https://github.com/ps5-payload-dev/sdk/releases/tag/v0.43). The scripts invoke Zig's Clang/LLD against the PS5 SDK, not host libc.

## Prepare

1. Install Node.js and extract Zig and the PS5 payload SDK.
2. Run `npm ci` in this repository.
3. Download and extract `TacHen-build-inputs.zip` from this release into a local directory. It contains the exact PS5 static libraries, SQLite header, and their SHA-256 manifest.
4. Set the paths below, then prepare pinned components, test and build.

```powershell
$env:ZIG = 'C:\tools\zig\zig.exe'
$env:PS5_PAYLOAD_SDK = 'C:\tools\ps5-payload-sdk'
$env:TACHEN_DOWNLOAD_LIBS = 'C:\inputs\download'
$env:TACHEN_SQLITE_LIB = 'C:\inputs\catalog\libsqlite3.a'
$env:TACHEN_SQLITE_HEADER = 'C:\inputs\catalog\sqlite3.h'
node scripts/prepare-components.mjs
npm run build
npm test
```

The build checks each component/static input against pinned hashes and verifies embedded assets. `build/tachen-bundled.elf` is the release payload, renamed **TacHen-compatibility.elf**. It selects the embedded runtime. The unchanged Beta 1 **TacHen.elf** is built from tag `v0.1.0-beta.1`, not the compatibility source. `build/tachen.elf` follows saved update selection; `build/tachen-runtime.elf` is the direct developer runtime. They are not additional payloads users need to send.

`build/manifest.json` records source identity and artifact hashes. Its `hardwareVerified: false` fields mean the build itself cannot attest to hardware tests, not that community feedback is discarded; release notes carry the reported testing status separately.

## Dependency source and credits

`TacHen-third-party-sources.zip` contains the pinned kstuff-lite, ShadowMountPlus, Payload Manager and SDK source, required component submodules, and the linked-library source/licenses. `vendor/release-sources.json` records archive origins and SHA-256 checksums. The pacbrew recipe collection and the matching historical curl 8.10.1 recipe document the PS5 cross-build approach. Component projects have their own build instructions.

The PS5 library inputs came from the etaHEN build inputs recorded in `vendor/download/inputs.json`; SQLite 3.46.1 came from the PS5 SDK homebrew package. Upstream library versions were checked against the exact archives. Sources and recipes are included, but bit-for-bit reproduction of those prebuilt dependencies across toolchain installations is not claimed. TacHen's own source and build scripts are supplied in full.

See NOTICE.md for author attribution. Local `.local`, `build`, private diagnostics and test-delivery folders are not source-release contents.

## Firmware data

`vendor/firmware-provenance.json` is the canonical table with source commits, exact values and append-only update bit assignments. Run `node scripts/generate-firmware-profiles.mjs` after an intentional table change. The build checks generated files for drift. `vendor/firmware-baseline-beta1.json` preserves the original fourteen profiles for regression checks.

Compatibility packages use a version 2 update header with a 96-bit firmware bitmap; the first fourteen bit identities are unchanged and version 1 packages remain readable. Only the 67 assigned bits are accepted. The native and JavaScript parsers are tested against every one-bit profile and malformed inputs. Update selection is isolated at `/data/tachen/updates-compatibility`.

The optional local build delivery setting copies this build to `TacHen-compatibility.elf`; it does not overwrite `TacHen-latest.elf` from Beta 1.
