// SPDX-License-Identifier: GPL-3.0-or-later
// A resident thread shares ShellUI's credentials and syscall policy. Keep the
// SDK's dynamic linking/kernel access initialization, but omit its standalone
// payload policy changes, as in the working etaHEN ShellUI port.
int __wrap___patch_init(void){return 0;}
