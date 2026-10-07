# Package installer ABI review — October 7, 2026

Native package installation remains gated to 13.60. File staging is separate.
The goal still includes the other supported firmware profiles; this review does
not waive their installer integration or establish hardware compatibility.

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
