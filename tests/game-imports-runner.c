// SPDX-License-Identifier: GPL-3.0-or-later
#include "game-imports.h"
#include "check.h"
#include <string.h>
#include <stdio.h>
static unsigned char memory[0x2000];
#define K UINT64_C(0xffff800000000000)
static int read_bytes(void *arg,uint64_t at,void *out,size_t n){
 (void)arg;if(at<K||at-K>sizeof memory||n>sizeof memory-(at-K))return -1;memcpy(out,memory+(at-K),n);return 0;
}
static void put64(size_t at,uint64_t v){memcpy(memory+at,&v,8);}
static void put32(size_t at,uint32_t v){memcpy(memory+at,&v,4);}
static void setup(void){
 memset(memory,0,sizeof memory);put64(0x148,K+0x200);
 put64(0x228,K+0x400);put64(0x230,72);put64(0x238,K+0x600);put64(0x240,80);put64(0x248,K+0x800);put64(0x250,48);
 strcpy((char*)memory+0x601,"YndgXqQVV7c#A#B");strcpy((char*)memory+0x620,"q1cHNfGycLI#A#B");
 put32(0x418,1);put32(0x430,32);
 put64(0x800,0x2000);put64(0x808,(UINT64_C(1)<<32)|7);
 put64(0x818,0x2010);put64(0x820,(UINT64_C(2)<<32)|7);
}
int main(int argc,char **argv){
 (void)argv;if(argc>1)CHECK(0);
 TacMemoryReader r={NULL,read_bytes};TacMemoryModule m={.object=K,.base=0x400000};uint64_t slots[2];
 setup();CHECK(!tac_game_pad_imports(&r,&m,slots)&&slots[0]==0x402000&&slots[1]==0x402010);
 setup();memory[0x607]='X';CHECK(!tac_game_pad_imports(&r,&m,slots)&&!slots[0]&&slots[1]);
 setup();memory[0x41e]=1;CHECK(!tac_game_pad_imports(&r,&m,slots)&&!slots[0]&&slots[1]);
 setup();put64(0x820,(UINT64_C(1)<<32)|7);CHECK(tac_game_pad_imports(&r,&m,slots)&&!slots[0]&&!slots[1]);
 setup();put64(0x808,(UINT64_C(99)<<32)|7);CHECK(tac_game_pad_imports(&r,&m,slots));
 setup();put32(0x418,80);CHECK(tac_game_pad_imports(&r,&m,slots));
 setup();put64(0x800,0x2001);CHECK(tac_game_pad_imports(&r,&m,slots));
 setup();put64(0x800,UINT64_MAX);CHECK(tac_game_pad_imports(&r,&m,slots));
 setup();put64(0x250,25);CHECK(tac_game_pad_imports(&r,&m,slots));
 setup();put64(0x230,UINT64_MAX);CHECK(tac_game_pad_imports(&r,&m,slots));
 setup();put64(0x238,K+sizeof memory-8);CHECK(tac_game_pad_imports(&r,&m,slots));
 setup();memset(memory+0x600,'x',80);CHECK(tac_game_pad_imports(&r,&m,slots));
 setup();put64(0x250,0);CHECK(!tac_game_pad_imports(&r,&m,slots)&&!slots[0]&&!slots[1]);
 puts("Bounded game import lookup, symbol identity and malformed metadata checks passed");return 0;
}
