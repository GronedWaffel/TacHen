# Native panel interface evidence

The native panel integration is based on an existing, private local ShellUI
managed-code capture in Neighborhood's `research/psn-signin` directory. No
console was contacted to obtain it for this work. This repository includes no
Sony assemblies, IL bodies or proprietary implementation. Only the interface
contracts needed by TacHen's original renderer are recorded here.

The saved IL uses `Sce.PlayStation.PUI.UI2.Panel` with an instance parameterless
constructor. It sets X/Y/Width/Height through `Sce.PlayStation.PUI.UINode` using
single-precision floats; sets `Panel.BackgroundColor` with a PUI UIColor value;
and passes the panel to `UI2.Widget.AppendChild(Widget)`. UIColor construction
uses four single-precision components. Those calls occur together at saved IL
lines 22866–22921. Separate references at 88644–88695 establish
`UINode.Visible` as an instance Boolean setter. The exact line numbers refer
to that private disassembly only, not to a redistributed source file.

Runtime preparation resolves the Panel class, checks Widget ancestry, validates
constructor and setter signatures, and requires the BackgroundColor parameter
to be the same resolved UIColor class (whose 16-byte value size is checked).
Static setters and mismatched argument types are rejected. Any missing contract
prevents hook publication; firmware offsets are not substituted. Labels and
panels use resolved managed entry points on the UI thread. No native ABI is
inferred solely from a firmware version.

The implementation creates twelve hidden, GC-rooted panels before the text
labels. Geometry, colors and visibility come from a pure C layout. Unchanged
frames perform no managed mutations; selection changes update their highlights.
Scene replacement hides/removes old panels and releases their handles. Errors
use the same cleanup path. Browser preview uses that C output, with substitute
browser fonts, and is not proof of native rendering or lower-firmware ABI parity.

Still required during the final console phase: successful metadata preparation,
correct insertion/compositing in dashboard and game scenes, foreground contrast,
controller arbitration, scene replacement, timely hiding on stale state, and
safe game transitions across the supported profiles.

Private evidence fingerprints (for local reproducibility):

- Managed capture: SHA-256 `80497a657fa1c3d14e11c79d7903d127da889d01846b2f6fa661b6e28c9f47ec`.
- Saved IL: SHA-256 `237bef7351162f8df03d68f86b3701e96dbe7af405015bb573c6a35b1ba98d11`.
