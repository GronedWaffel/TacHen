# SPDX-License-Identifier: GPL-3.0-or-later
"""Check every profile against exact public source files, without console access.

Usage: python scripts/audit-firmware-sources.py <extracted-firmware-references>
The release's TacHen-firmware-references.zip supplies the pinned input files.
"""
from pathlib import Path
import hashlib
import json
import re
import sys

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1])
data = json.loads((root / 'vendor/firmware-provenance.json').read_text(encoding='utf-8'))

def check(condition, detail):
    if not condition:
        raise ValueError(detail)

def text(name):
    raw = (source / name).read_bytes()
    if name in data['sourceFiles']:
        check(hashlib.sha256(raw).hexdigest() == data['sourceFiles'][name], 'Source hash: ' + name)
    return raw.decode('utf-8')

sdk = {}
kernel = text('sdk/crt/kernel.c')
for block in kernel[kernel.index('switch(kernel_get_fw_version() & 0xffff0000)'):].split('break;'):
    fields = {key: (sign, int(value, 16)) for key, sign, value in re.findall(
        r'KERNEL_ADDRESS_(\w+)\s*=\s*KERNEL_ADDRESS_DATA_BASE\s*([+-])\s*(0x[\da-f]+)', block, re.I)}
    if fields:
        for code in re.findall(r'case (0x[\da-f]+):', block, re.I):
            sdk[int(code, 16)] = fields
pager = {}
for block in text('ftp/self-prospero.c').split('break;'):
    value = re.search(r'KERNEL_ADDRESS_PAGER_TABLE\s*=\s*KERNEL_ADDRESS_DATA_BASE\s*\+\s*(0x[\da-f]+)', block, re.I)
    if value:
        for code in re.findall(r'case (0x[\da-f]+):', block, re.I):
            pager[int(code, 16) << 16] = int(value[1], 16)
anchor = text('kstuff/prosper0gdb/r0gdb.c')
check(re.search(r'if\s*\(\s*\(r0gdb_get_fw_version\(\)\s*>>\s*16\)\s*<=\s*0x270\)\s*kdata_base\s*-=\s*0x1010000', anchor), 'Early firmware anchor evidence missing')
mapping = {'allproc':'allproc', 'sysentvec':'sysentvec', 'sysentvecPs4':'sysentvec_ps4',
           'cryptSingletonArray':'crypt_singleton_array', 'sysents':'sysents', 'sysentsPs4':'sysents_ps4'}
for profile in data['firmwares']:
    fw, offsets, code = profile['firmware'], profile['offsets'], int(profile['code'], 16)
    raw = (source / ('kstuff/prosper0gdb/offsets/' + fw.replace('.', '_') + '.h')).read_bytes()
    check(hashlib.sha256(raw).hexdigest() == profile['kstuffTableSha256'], 'kstuff source hash: ' + fw)
    upstream = {k:int(v, 16) for k,v in re.findall(r'DEF\((\w+),\s*(0x[\da-f]+)\)', raw.decode('utf-8'), re.I)}
    adjustment = -0x1010000 if code < 0x03000000 else 0
    check(profile['kstuffAnchorAdjustment'] == adjustment, 'Anchor: ' + fw)
    for target, key in mapping.items():
        check(offsets[target] == upstream[key] + adjustment, fw + ' kstuff ' + target)
    for target, key in [('allproc','ALLPROC'),('security','SECURITY_FLAGS'),('rootvnode','ROOTVNODE'),('textDelta','TEXT_BASE')]:
        sign = '-' if target == 'textDelta' else '+'
        check(sdk[code][key] == (sign, offsets[target]), fw + ' SDK ' + target)
    check(pager[code] == offsets['pagerTable'], fw + ' pager')
print(f"Verified {len(data['firmwares'])} exact profiles, ten fields each, against pinned public source bytes.")
