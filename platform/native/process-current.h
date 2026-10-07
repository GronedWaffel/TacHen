// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
// Caller owns the native operation guard. Reject a stale SDK PID cache before
// using any SDK API that internally dereferences its cached proc pointer.
int tac_process_current(int pid);
