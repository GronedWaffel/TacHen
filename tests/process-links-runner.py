# SPDX-License-Identifier: GPL-3.0-or-later
import importlib.util
import struct
import tempfile
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_IMM

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('audit', root / 'scripts/audit-process-links.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for part in ('runtime', 'deck', 'package-helper', 'save-helper'):
    module.audit(root / 'build' / f'tachen-{part}.elf')
module.audit(root / 'build/tachen.elf')

# Prove that the auditor detects an actual SDK call redirected back to the
# legacy cached lookup, without changing the built artifacts on disk.
data = bytearray((root / 'build/tachen-runtime.elf').read_bytes())
shoff, = struct.unpack_from('<Q', data, 40)
width, count = struct.unpack_from('<HH', data, 58)
sections = [struct.unpack_from('<IIQQQQIIQQ', data, shoff + i * width) for i in range(count)]
symbols = {}
for sec in sections:
    if sec[1] != 2:
        continue
    strings = sections[sec[6]]
    strings = data[strings[4]:strings[4] + strings[5]]
    for pos in range(sec[4], sec[4] + sec[5], sec[9]):
        name, info, other, index, value, size = struct.unpack_from('<IBBHQQ', data, pos)
        name = strings[name:strings.find(b'\0', name)].decode()
        symbols[name] = (index, value, size)
index, address, size = symbols['kernel_get_proc_ucred']
section = sections[index]
offset = section[4] + address - section[3]
decoder = Cs(CS_ARCH_X86, CS_MODE_64)
decoder.detail = True
patched = False
for ins in decoder.disasm(bytes(data[offset:offset + size]), address):
    if ins.mnemonic == 'call' and ins.operands[0].type == X86_OP_IMM and ins.operands[0].imm == symbols['__wrap_kernel_get_proc'][1]:
        if ins.imm_size != 4:
            raise RuntimeError('Expected direct rel32 call')
        struct.pack_into('<i', data, offset + ins.address - address + ins.imm_offset,
                         symbols['kernel_get_proc'][1] - ins.address - ins.size)
        patched = True
        break
if not patched:
    raise RuntimeError('Regression fixture could not find the real internal SDK call')
with tempfile.TemporaryDirectory(prefix='tachen-links-') as tmp:
    file = Path(tmp) / 'regressed.elf'
    file.write_bytes(data)
    try:
        module.audit(file)
    except ValueError as error:
        if 'legacy lookup/cache' not in str(error):
            raise
    else:
        raise RuntimeError('Auditor accepted an actual call into the legacy cache')
print('five artifacts and negative link regression passed')
