#!/usr/bin/env node
// Natural file-select flow through the real UI with a NOR-flash model (compact).
// usage: node games/dk/tools/test_natural_flow.mjs <seed-flash.bin|NONE> [rom]
// Boots with garbage SRAM, taps START twice, selects File 1 with A and plays a few
// seconds of the first level; prints flash program counts and checks that every
// commit-stub entry had IME on and FF8C == the mapped bank.  Screens: games/dk/analysis/nat-*.png
import fs from 'node:fs';
import { loadRom, tapKey, holdKey, savePng } from '../../../tools/gb_harness.mjs';
const ROM=process.argv[3]||'roms/dk-hc007.gb';
const coreOf=(gb)=>gb[Object.keys(gb)[0]].gameboy;
const frame=(gb,n)=>{for(let i=0;i<n;i++)gb.doFrame();};
// reuse the flash model from the main test by importing nothing: replicate minimal
import { createRequire } from 'node:module';
const seedPath=process.argv[2];
const seed = fs.existsSync(seedPath)?fs.readFileSync(seedPath):null;
function flash(gb,seed){ const core=coreOf(gb); const data=new Uint8Array(0x10000).fill(0xFF); if(seed) data.set(seed.subarray(0,0x10000));
 const st={mode:'read',programs:0,erases:0,entries:[]};
 const inLog=(p)=>(p.ROMBank1offs||0)>=0x20&&(p.ROMBank1offs||0)<=0x23; const off=(p,a)=>((p.ROMBank1offs||0)-0x20)*0x4000+(a-0x4000);
 const ir=core.memoryReader[0]; core.memoryReader[0]=(p,a)=>st.mode==='id'?0x20:ir(p,a);
 const w0=core.memoryWriter[0x0AAA]; core.memoryWriter[0x0AAA]=(p,a,v)=>{ if(v===0xA0)st.mode='program'; else if(v===0x80)st.mode='erase'; else if(v===0x90)st.mode='id'; return w0(p,a,v);};
 for(let a=0x4000;a<0x8000;a++){ const ow=core.memoryWriter[a]; core.memoryWriter[a]=(p,ad,v)=>{ if(ad===0x4000&&v===0xF0)st.mode='read'; if(inLog(p)){ if(st.mode==='program'){data[off(p,ad)]&=v;st.programs++;st.mode='read';return;} if(st.mode==='erase'&&v===0x30){data.fill(0xFF);st.erases++;st.mode='read';return;} } return ow(p,ad,v);}; const or=core.memoryReader[a]; core.memoryReader[a]=(p,ad)=>inLog(p)?data[off(p,ad)]:or(p,ad);} 
 const o=core.memoryReader[0x3910]; core.memoryReader[0x3910]=(p,ad)=>{st.entries.push({ime:core.IME,shadow:core.memoryReader[0xFF8C](core,0xFF8C),bank:core.ROMBank1offs||0});return o(p,ad);};
 return {data,st}; }
const garbage=new Uint8Array(0x8000); for(let i=0;i<garbage.length;i++) garbage[i]=(i*2654435761>>>7)&0xFF;
const gb=loadRom(ROM,Buffer.from(garbage),{skipTitle:true}); const f=flash(gb,seed); const core=coreOf(gb);
frame(gb,300); tapKey(gb,'START',10); frame(gb,400); tapKey(gb,'START',10); frame(gb,400);
console.log('at select file: programs',f.st.programs,'entries',f.st.entries.length);
savePng(gb.getScreen(),'games/dk/analysis/nat-1-select.png');
tapKey(gb,'A',120); savePng(gb.getScreen(),'games/dk/analysis/nat-2-after-A.png');
console.log('after A: programs',f.st.programs,'entries',JSON.stringify(f.st.entries.slice(-3)));
tapKey(gb,'A',200); tapKey(gb,'A',300); savePng(gb.getScreen(),'games/dk/analysis/nat-3-level.png');
for (const k of ['RIGHT','LEFT','RIGHT']) { holdKey(gb,k,100); tapKey(gb,'A',20);} frame(gb,200);
savePng(gb.getScreen(),'games/dk/analysis/nat-4-play.png');
console.log('end: programs',f.st.programs,'erases',f.st.erases,'entries',f.st.entries.length,'allShadowOK',f.st.entries.every(e=>e.shadow===e.bank),'allIME',f.st.entries.every(e=>e.ime));
fs.writeFileSync('games/dk/analysis/nat-flash.bin',f.data);
