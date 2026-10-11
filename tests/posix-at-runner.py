# SPDX-License-Identifier: GPL-3.0-or-later
import struct
import subprocess
from pathlib import Path
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *
root = Path(__file__).resolve().parents[1]
zig = root.parent / 'ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe'
out = root / 'build/tests/posix-at'
out.mkdir(parents=True, exist_ok=True)
(out/'stubs.S').write_text('.text\n.global __crt_syscall\n__crt_syscall: ret\n.global __error\n__error: ret\n', encoding='utf8')
for source, target in [(root/'platform/loader/posix-at.S',out/'at.o'),(out/'stubs.S',out/'stubs.o')]:
    subprocess.run([str(zig),'cc','-target','x86_64-linux-none','-c',str(source),'-o',str(target)],check=True,capture_output=True)
subprocess.run([str(zig),'ld.lld','-e','__wrap_openat',str(out/'at.o'),str(out/'stubs.o'),'-o',str(out/'at.elf')],check=True,capture_output=True)
b=(out/'at.elf').read_bytes()
off=struct.unpack_from('<Q',b,40)[0];size,count=struct.unpack_from('<HH',b,58)
sections=[struct.unpack_from('<IIQQQQIIQQ',b,off+i*size) for i in range(count)]
symbols={}
for sec in sections:
    if sec[1]!=2:continue
    st=sections[sec[6]];strings=b[st[4]:st[4]+st[5]]
    for pos in range(sec[4],sec[4]+sec[5],24):
        n,_,_,idx,addr,length=struct.unpack_from('<IBBHQQ',b,pos)
        symbols[strings[n:strings.find(b'\0',n)].decode()]=addr
for name,num in [('mkdirat',496),('openat',499),('renameat',501),('unlinkat',503),('fstatat',493)]:
    for fail,value in [(False,0),(False,2),(False,87),(True,2),(True,17),(True,28)]:
        u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0x200000,0x100000);u.mem_map(0x700000,0x20000)
        for s in sections:
            if s[2]&2 and s[1]!=8 and s[5]:u.mem_write(s[3],b[s[4]:s[4]+s[5]])
        stack=0x710008;stop=0x700100;err=0x700200
        u.mem_write(stack,struct.pack('<Q',stop));u.mem_write(err,struct.pack('<I',99));u.reg_write(UC_X86_REG_RSP,stack)
        for reg,arg in [(UC_X86_REG_RDI,11),(UC_X86_REG_RSI,22),(UC_X86_REG_RDX,33),(UC_X86_REG_RCX,44)]:u.reg_write(reg,arg)
        seen=[]
        def hook(uc,address,_size,_):
            if address==stop:uc.emu_stop();return
            if address not in [symbols['__crt_syscall'],symbols['__error']]:return
            rsp=uc.reg_read(UC_X86_REG_RSP);assert rsp%16==8
            if address==symbols['__crt_syscall']:
                assert [uc.reg_read(r) for r in [UC_X86_REG_RDI,UC_X86_REG_RSI,UC_X86_REG_RDX,UC_X86_REG_RCX,UC_X86_REG_R8]]==[num,11,22,33,44]
                uc.reg_write(UC_X86_REG_RAX,value);uc.reg_write(UC_X86_REG_EFLAGS,(uc.reg_read(UC_X86_REG_EFLAGS)&~1)|int(fail));seen.append('gate')
            else:uc.reg_write(UC_X86_REG_RAX,err);seen.append('errno')
        u.hook_add(UC_HOOK_CODE,hook);u.emu_start(symbols['__wrap_'+name],stop+1,count=100)
        assert u.reg_read(UC_X86_REG_RAX)==(2**64-1 if fail else value)
        assert struct.unpack('<I',u.mem_read(err,4))[0]==(value if fail else 99)
        assert u.reg_read(UC_X86_REG_RSP)==stack+8
        assert seen==(['gate','errno'] if fail else ['gate'])
print('30 POSIX syscall cases passed: arguments, carry errors, errno, stack alignment and successful descriptors')
