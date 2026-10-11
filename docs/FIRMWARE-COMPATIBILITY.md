# Firmware compatibility preview

This build adds 53 public offset profiles to the original fourteen. All 67 exact
versions are listed in the README. Added profiles are untested on hardware with
TacHen. Below 11.00, compatibility is theoretical; finding offsets does not prove
that the console menu or every component works. 11.40 is also untested.

## Sources and coordinate systems

Each row in `vendor/firmware-provenance.json` contains immutable source URLs and
ten required fields. These are PS5 tables, not similarly numbered PS4 firmware:

- [PS5 Payload SDK kernel definitions](https://github.com/ps5-payload-dev/sdk/blob/f5d40f02770e9b0001dd9e18056eca70b3da8b40/crt/kernel.c): allproc, security flags, root vnode and kernel text/data delta.
- [kstuff-lite offsets](https://github.com/EchoStretch/kstuff-lite/tree/48cd2c4ce62aa9ca0c2cc014c1e512f276ae7c17/prosper0gdb/offsets): native/PS4 syscall vectors and tables, and the crypto singleton array. Its allproc offset cross-checks the SDK anchor.
- [ftpsrv SELF support](https://github.com/ps5-payload-dev/ftpsrv/blob/23737c4738d15b9b9b036665bbf008d8fd6d82d2/self-prospero.c): pager table.

For 1.xx and 2.xx, the historical kstuff base differs from the SDK DATA base by
`0x1010000`. The six kstuff fields are normalized by subtracting that delta.
This is supported by the upstream [base adjustment](https://github.com/EchoStretch/kstuff-lite/blob/48cd2c4ce62aa9ca0c2cc014c1e512f276ae7c17/prosper0gdb/r0gdb.c#L1719-L1728),
and the normalized allproc addresses match the SDK. Raw early-firmware kstuff
offsets must not be mixed with SDK-relative values.

The SDK fields also match the SDK v0.43 used to compile TacHen, and the relevant
kstuff fields match the pinned kstuff-lite 1.11 source. The component ELFs and
their hashes have not changed. No PS5 14.00+ profile was found in the reviewed
sources. Relapse exploit tables are not a prerequisite for running an already
jailbroken console's standalone TacHen payload.

## Checks versus hardware evidence

Regression checks compare all original offsets to the Beta 1 baseline, match
native and JavaScript selectors to the source records, and exercise every update
firmware bit individually. Unknown firmware remains rejected; adjacent version
numbers never borrow offsets. The build verifies all embedded assets.

This build passed 559 automated tests. All 670 profile values were also checked
against the pinned public source bytes. To repeat that source audit, extract
`TacHen-firmware-references.zip` and run
`python scripts/audit-firmware-sources.py <extracted-directory>`.

These checks do not validate firmware-dependent ShellUI methods, package/save
ABIs, game modules or bundled component behavior on hardware. Existing runtime
method discovery and operation-specific checks remain in place. If a feature
is unavailable, report its actual result rather than treating the presence of
the firmware table as a successful test.

## Original release and update isolation

The separate `TacHen-compatibility.elf` contains the expanded profile list.
`TacHen.elf` remains the original Beta 1 asset, with the original fourteen
profiles and original bytes. Its source is tag `v0.1.0-beta.1`.

The compatibility updater uses `/data/tachen/updates-compatibility`; the original
uses `/data/tachen/updates`. Normal settings and library files remain shared.
Reboot before changing builds. No console injections or hardware tests were
performed as part of this compatibility expansion.
