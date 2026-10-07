# Package installer ABI review — October 7, 2026

## Current implementation: historical common prefix

Native installation is now integrated for TacHen's 14 exact target profiles.
No firmware has passed TacHen's deferred console acceptance. This decision uses
the shared state and byte-counter fields instead of applying the 13.60 error
tail to other firmware.

The follow-up inspected etaHEN's first public source and older releases:

- [First public source, 03d016f](https://github.com/etaHEN/etaHEN/blob/03d016fd316ecf0a1841465bef8937a71352bff0/Source%20Code/util/source/DirectPKGInstaller.cpp).
- [2.4B, d47f99b](https://github.com/etaHEN/etaHEN/blob/d47f99bd37f349ae59b3c4b66e09e93ba69f56cd/Source%20Code/util/source/DirectPKGInstaller.cpp).
- [2.5B metadata, 5061a85](https://github.com/etaHEN/etaHEN/blob/5061a85312eb1d2da811269bcb9061e4b01302a1/Source%20Code/util/include/common_utils.h).
- [2.4B custom installer hook](https://github.com/etaHEN/etaHEN/blob/d47f99bd37f349ae59b3c4b66e09e93ba69f56cd/Source%20Code/shellui/src/HookFunctions.cpp).

All three historical status declarations have a 600-byte layout with the error
at 0x3c; the captured 13.60 layout is 712 bytes with the error at 0xa0. Both put
the state at 0, downloaded bytes at 0x20 and total bytes at 0x30. TacHen reads
only that 56-byte common prefix on lower firmware. Output uses aligned 4096-byte
storage to accommodate both known layouts; that capacity is not a claim about
an unknown firmware's structure or a substitute for hardware validation. Invalid
state strings or impossible counters stop tracking. Only 13.60 reads the known
numeric error field. Elsewhere the textual error state and API return codes
report failures without inventing numeric details.

The six metadata pointers from older releases retain their offsets in TacHen's
zero-initialized 56-byte input, which also supplies the documented option/flag.
Submission is still once only. Completion still requires observed matching
progress and repeated terminal observations, never just API acceptance or bytes
served. Existing identity, checksum, descriptor and lifecycle guards remain.

This is source-contract evidence, not proof of lower-firmware execution: the
historical DPI progress loop was disabled under `#if 0`, and the custom installer
hook submits without proving completion. Older release support lists cannot
establish that every current target has the same native contract. Synthetic
native fixtures verify decoding both declarations, ignoring unknown tails,
64-bit counts and textual errors; attended testing remains necessary.

## Historical review through checkpoint 45

At this stage native installation was gated to 13.60 while lower-firmware
contract evidence was investigated. The following records that investigation.

TacHen's `platform/native/package-abi.h` follows the local Neighborhood 13.60
marshaller investigation recorded in that project's `docs/PS5-VALIDATION.md`:
the installation metadata includes a uint32 option at 0x30 and byte flag at
0x34 (56 bytes including alignment); the status buffer is 712 bytes with its
error at 0xa0. The former six-pointer metadata and shorter status declaration
were incomplete for those inspected entry points. Private system captures are
not included in TacHen source.

Public sources inspected at pinned revisions:

- [etaHEN's original PKG writeup](https://github.com/etaHEN/etaHEN/blob/dafa13b562ddb137a4b4a97b9aaa287c0c57cc9c/PS5%20technical%20writeups/pkg-writeup.md)
  describes the AppInstUtil route and the managed call carrying strings, a slot
  option and a Boolean. That description is useful provenance, but does not
  identify every firmware's native wrapper/status layout.
- [itsPLK package-manager header](https://github.com/itsPLK/ps5-pkg-manager/blob/a35943f80e0664e4e7d9b4c410d8ada6a57da9e2/include/install_appinst.h)
  still declares six metadata pointers without those additional fields.
- [MaxMilu direct-installer header](https://github.com/MaxMilu/ps5-direct-package-installer/blob/1eaf13ab1819ae6add0dbd5532d33f5807594636/include/appinst.hpp)
  also has the six-pointer metadata and the older status layout with the error
  directly after promotion percentage.

These are implementation examples, not proof that the 13.60 structure applies
to lower firmware or that the older declarations are complete there. Generic
firmware support statements and INVALID_SLOT reports cannot distinguish an ABI
mismatch from source, network, slot or caller-state failures.

The lower-firmware gate must change only with exact wrapper/layout evidence or
a verified interface that avoids the unstable structures. No offsets were
guessed, no firmware probe was sent to the console, and no native package call
was made during this review. Console acceptance remains the final phase.


Follow-up local inspection found Neighborhood's saved 65,536-byte executable
mapping for libSceAppInstUtil (SHA-256
`098cb67d05e98d729cd3f945b01731feb7cecd56f5bfca9a3fb359100cae7402`).
The original companion source at commit cbafd8a identifies the saved anchor as
GetPatchInstallStatus. Its path submits a 0x2c8-byte output buffer through IPC.
This confirms the existing 13.60 buffer-size evidence, not the field layout
returned by another firmware's ShellCore. Hashing only the client library would
not establish that server-side layout, so no cross-firmware capability was
enabled from that fingerprint. The capture is private and not redistributed.
The saved ShellUI application IL contains AppInst wrapper references but does
not supply the required install/status wrapper definitions. No console probe
or installation was performed for this follow-up.


The next local audit considered a read-only managed metadata probe as an
alternative to fixed layouts. The saved ShellUI application references the
separate `Sce.Vsh.AppInstUtilWrapper` assembly, but the relevant assembly and
install/status type definitions are not among the available captures. Managed
field offsets alone would not establish native marshalled layout for strings,
arrays or Boolean fields. Without those definitions/marshalling evidence, this
route cannot currently justify a firmware-wide native adapter. No speculative
probe or package call was added, and no console was contacted.

## Local-file delivery correction

A further primary-source review found phantomptr/ps5upload's installer at
[`95f09e318915db94a247f54d37a1739e00448d0c`](https://github.com/phantomptr/ps5upload/blob/95f09e318915db94a247f54d37a1739e00448d0c/payload/installer/sony.c).
It documents failures passing plain local paths on 13.60 and primarily serves
the file over loopback HTTP. Its metadata investigation also concerns 13.60;
it does not resolve our lower-firmware status layout gap.

TacHen now serves its already verified descriptor through an original temporary
loopback HTTP source instead of passing a bare filename. It submits the URL once,
without trying other install routes after an uncertain result. Four clients,
bounded headers/buffers, single byte ranges, request/idle deadlines and an exact
request path keep this independent of phone sessions. Metadata changes or short
file reads stop the source and leave the install result uncertain. Native install
status is still required for completion; HTTP bytes sent are not installation
proof. The source stops on helper exit and retains the uploaded file. Native
socket tests run on the Windows development host, not on a PS5.
