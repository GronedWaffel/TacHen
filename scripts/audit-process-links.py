#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Inspect final ELF machine code, not merely --wrap in the linker arguments.

Requires Capstone 5 (development host only). No console or network access.
The original SDK function stays in crt1.o; it must have no external code/data
references. SDK PID cache storage must only be referenced by that dead function.
"""
import json
import struct
import sys
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_IMM, X86_OP_MEM, X86_REG_RIP


def audit(path):
    data = Path(path).read_bytes()
    if data[:6] != b'\x7fELF\x02\x01':
        raise ValueError('Expected little-endian ELF64')
    unpack = lambda fmt, offset: struct.unpack_from(fmt, data, offset)
    shoff, = unpack('<Q', 40)
    width, count = unpack('<HH', 58)
    sections = [unpack('<IIQQQQIIQQ', shoff + i * width) for i in range(count)]
    symbols = {}
    for section in sections:
        if section[1] != 2:
            continue
        strings = sections[section[6]]
        strings = data[strings[4]:strings[4] + strings[5]]
        for offset in range(section[4], section[4] + section[5], section[9]):
            name, info, other, index, value, size = unpack('<IBBHQQ', offset)
            name = strings[name:strings.find(b'\0', name)].decode()
            if name:
                symbols[name] = (value, size, index, info & 15)
    old = symbols['kernel_get_proc']
    fresh = symbols['__wrap_kernel_get_proc']
    caches = [value for name, value in symbols.items() if name.startswith('proc_cache')]
    if not caches or not old[1] or not fresh[1] or old[0] == fresh[0]:
        raise ValueError('Expected distinct legacy/cache/fresh symbols')
    forbidden = [old, *caches]
    violations = []
    callers = set()
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    decoder.detail = True
    for name, (address, size, index, kind) in symbols.items():
        if kind != 2 or not size or not 0 < index < len(sections):
            continue
        section = sections[index]
        if not section[2] & 4:  # executable
            continue
        start = section[4] + address - section[3]
        code = data[start:start + size]
        decoded = 0
        for ins in decoder.disasm(code, address):
            decoded += ins.size
            references = []
            for op in ins.operands:
                if op.type == X86_OP_IMM:
                    references.append(op.imm & ((1 << 64) - 1))
                elif op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP:
                    references.append(ins.address + ins.size + op.mem.disp)
            for target in references:
                if target == fresh[0]:
                    callers.add(name)
                if name != 'kernel_get_proc' and any(a <= target < a + n for a, n, _, _ in forbidden):
                    violations.append(f'{name}+0x{ins.address-address:x}: reference to legacy lookup/cache')
        if decoded != size:
            violations.append(f'{name}: undecoded function bytes ({decoded}/{size})')
    # PIE references stored through relocations are not necessarily visible as
    # direct calls. Include all allocated RELA sections (ignore debug metadata).
    for section in sections:
        if section[1] != 4 or not section[2] & 2:
            continue
        linked = sections[section[6]] if section[6] else None
        for offset in range(section[4], section[4] + section[5], section[9]):
            location, info, addend = unpack('<QQq', offset)
            symbol = info >> 32
            target = addend
            if symbol and linked:
                entry = linked[4] + symbol * linked[9]
                target += unpack('<IBBHQQ', entry)[4]
            if any(a <= target < a + n for a, n, _, _ in forbidden):
                violations.append(f'relocation at 0x{location:x}: legacy lookup/cache reference')
    required = {'kernel_get_proc_ucred', 'kernel_dynlib_obj', 'kernel_get_vmem_entry'}
    missing = required - callers
    if missing:
        violations.append('SDK internal callers not redirected: ' + ', '.join(sorted(missing)))
    if violations:
        raise ValueError('\n'.join(violations))
    return {'file': Path(path).name, 'freshLookupCallers': sorted(callers),
            'legacyCodeOrRelocationReferences': 0, 'hardwareVerified': False}


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    files = sys.argv[1:] or [root / 'build' / f'tachen-{part}.elf' for part in ('runtime', 'deck', 'package-helper', 'save-helper')]
    for file in files:
        print(json.dumps(audit(file)))
