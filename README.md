# TacHen

An original PS5 control runtime and contextual command deck, with a console-hosted
phone interface. Development source, **not a completed or hardware-validated HEN**.

The exact firmware targets are 11.00, 11.20, 11.60, 12.00, 12.02, 12.20, 12.40,
12.60, 12.70, 13.00, 13.20, 13.40, 13.42 and 13.60. 11.40 is excluded. A declared
target is not evidence that a native operation has been tested on it.

## Development

`npm test` runs off-console tests. `npm run dev` opens a loopback-only development
server; it does not contact a PS5, load an existing HEN, or emulate successful native
operations. `npm run build` produces local artifacts when the documented toolchain
is available. Console testing is deliberately deferred until the owner returns.

The current native artifact is `build/tachen-runtime.elf`, a coordinator, local
phone interface on port 8780, native ELF dispatch, and an FTP share on port 2122. The FTP share is
`/data/tachen/share`, isolated from the coordinator's persistent state. Use FTP
user `tachen` or `anonymous` with any password on the trusted LAN. Development
servers bind only to loopback. This is **not** yet a replacement for etaHEN.

Phone uploads accept ELF, etaHEN plugin containers and native PRX/SELF headers,
then stream a SHA-256 verification. Uploading does not execute a payload. Incomplete
uploads retain their offset so a client can resume. Structural validation does not
establish compatibility with a particular game, firmware, or plugin API.

On console builds, verified ELF entries offer **Run payload**. A separate native
worker hashes the exact execution buffer, validates memory/relocation bounds and
spawns the payload with the PS5 payload ABI. Checksummed dispatch receipts survive
runtime restarts. **Dispatched** does not mean the payload initialized successfully.
The loader prevents another dispatch of the same payload during a console boot
and never silently retries a failed or interrupted spawn. These native operations
are cross-built but still await hardware acceptance.

FTP uploads into `/payloads` are copied into the verified inbox after the transfer
has committed. Other FTP files are ordinary transfers. Invalid payloads remain in
the FTP share and generate an actionable entry in Activity. Uploads do not autorun
unless that setting is explicitly enabled; `.plugin` and PRX files are never sent
through the standalone ELF loader.

`node scripts/test-quickjs.mjs` additionally executes portable core code in the
actual embedded JavaScript engine on Windows. `ZIG` and `PS5_PAYLOAD_SDK` can
override the local Zig 0.14.1 and PS5 payload SDK v0.43 paths in build scripts.

Original work lives in `src/`, `ui/` and `tests/`. Reused low-level foundations
must retain source, licensing and provenance. Existing etaHEN, Neighborhood,
ShadowMount and YouTube releases are not modified by this project.

See `docs/IMPLEMENTATION.md` for scope, current evidence and remaining work.
