# Support captures

Open **Preferences → Support capture** on the console-hosted phone page. Turn on
**Record support evidence** before reproducing a problem. For startup problems,
enable it before restarting TacHen. After the attempt, choose **Download support
report**. Share the downloaded `TacHen-support.json` explicitly; TacHen never
uploads it automatically. Developer MCP access and memory-write permission are
not required or enabled by recording.

Disable recording when finished. That preserves existing captures for download.
**Clear saved captures** replaces both storage slots. If recording is still
enabled, a new capture starts after the older captures are cleared. A failed
clear reports an error; storage errors are visible separately from whether
recording is requested. Existing corrupt captures are preserved until cleared.

## What is recorded

Each capture has its own ID, startup/mid-session boundary, firmware, runtime mode
and source fingerprint. Console builds also identify the bundled component
versions and hashes. This fingerprint covers source inputs in src, platform, ui,
scripts and vendor plus package manifests. It is not the ELF hash or a guarantee
of identical output from different SDK/compiler installations. The final ELF
hash is in `build/manifest.json`. Local Node development is explicitly marked
as unfingerprinted.

Events contain chronological sequence numbers, wall time and elapsed time.
Clock reversal is flagged. They cover coordinator startup phases, service
transitions, queue recovery, game title/version/process observations, job status
changes, error codes and selected numeric/boolean native receipt fields. Native
loader, deck, package, save, plugin/module, cheat, input and PS4 FPS preparation
adapters publish receipts they actually observe. Component readiness failures
have specific reason codes for hook, process/listener, API and configuration
disagreements. Reading a receipt does not assert that a dispatched plugin has
initialized its features.

Jobs get capture-local aliases. Earlier-session unfinished jobs are labelled;
old completed/failed jobs are not replayed as fresh failures. Baseline job
observations are marked separately from subsequent transitions. No credentials,
network address, account name, request key, upload identity, file path, file
contents, native freeform error prose or raw game memory is included. Unknown
receipt fields are dropped. The same projection is applied to reopened captures
before export; importing a JSON file cannot turn it into executable actions.

## Storage and limitations

The recorder retains three captures, each with up to 512 events. The first 64
events are retained along with the latest events. Omission counts and bounded
evidence truncation are explicit. There is no diagnostic polling timer: existing
job/service/lifecycle publications feed the recorder. Identical native receipts
are deduplicated. One atomic write runs at a time, with later changes coalesced.
Export does not wait indefinitely for future activity to stop.

The console stores `diagnostics-0.json` and `diagnostics-1.json` under
`/data/tachen/state`, separately from preferences/jobs. Each envelope has a
revision and checksum and uses the existing durable atomic-replace adapter.
The other valid slot can recover a torn write. If both slots are unreadable,
recording will not overwrite them automatically. Ordinary jobs continue if the
recorder cannot persist; export includes available RAM evidence and reports the
storage fault. No automatic retry of a native operation is caused by diagnostics.

An abrupt shutdown can omit a pending write. An unfinished earlier capture is
reported as an **unconfirmed stop**, not as proof of a kernel panic or system
software error. A coordinator-close event does not prove all native workers
settled. Early native startup before the coordinator, internal steps completed
between receipt polls, omitted ring events and raw ShellUI/game memory are not
captured. This is useful evidence, not a promise that every crash is diagnosable.
If TacHen cannot reach the phone server, the on-disk capture envelopes can be
preserved using an already available trusted console file tool.

The authenticated same-origin phone command API requires the session cookie and
CSRF token to export or clear captures. Ordinary state polling includes only
capture metadata, not the report. Downloads are inbound to the user's browser;
there is no external reporting endpoint in this implementation.

Local regression tests cover disabled recording, startup failure, receipt
redaction, slot recovery, disk failure isolation, bounded history, report export
during continued activity, consent across safe recovery, earlier-session jobs
and authenticated API access. The actual embedded QuickJS fixture exercises
capture, disable, export and clear. A development-browser download produced a
valid JSON file and the panel was checked at a 390-pixel viewport. Console
durability, native-stage completeness and real failure reproduction remain
hardware acceptance work.
