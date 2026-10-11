# Menu failure isolation

The resident menu's readiness comes from its own process identity and renderer
heartbeat. It must not be inferred from the health of Payload Manager,
ShadowMount, file transfers, or the service monitor's kstuff graph node.

Startup still verifies the actual kernel prerequisites before first injection.
Process names alone do not establish a conflicting ShellUI hook owner. Metadata
resolution, instruction relocation and the stopped-process publication checks
remain authoritative. Unsupported instructions or changed hook bytes reject the
menu's own injection; no forced overwrite or duplicate injection is attempted.

Optional service failures are recorded as incomplete startup with `degraded:
true`, while retaining the existing schema's `status: failed`. They do not set
global recovery mode. Independent configured services may continue; an uncertain
native dispatch keeps its resource lock and prevents another injection. Existing
verified services can still be adopted. Incomplete startup is never promoted as
a known-good configuration or acknowledged as a successful binary trial.

Unresolved or running file work keeps its original resource locks. Only work
sharing menu-injection resources can block that injection. A halted queue,
unreadable state, missing kernel prerequisites, or an uncertain previous menu
injection still cannot be bypassed automatically.

The available-menu notification always gives the L3 + R3 shortcut, including when
an optional feature needs attention. Feature errors remain visible in Activity
and the runtime log. No API-version or payload-name change is advertised as
hardware validated solely from these local tests.

Regression coverage includes: optional port conflict with a working menu and
continued independent startup; active and interrupted file work; no incomplete
update promotion; live kstuff monitoring loss with a healthy renderer; an actual
renderer heartbeat failure; changed ShellUI identity; and uncertain injection
without an automatic retry.
