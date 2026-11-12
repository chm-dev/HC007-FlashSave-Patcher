import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const settings = require(path.join(ROOT, 'tools/serverboy/src/gameboy_core/settings.js'));
const Gameboy = require(path.join(ROOT, 'tools/serverboy'));
settings[2] = true;
const gb = new Gameboy();
gb.loadRom(fs.readFileSync(path.join(ROOT, 'roms/sml2-hc007.gb')));
const core = gb[Object.keys(gb)[0]].gameboy;
for (let i = 0; i < 200; i++) gb.doFrame();
for (let i = 0; i < 3; i++) { core.JoyPad = 0xff; gb.pressKeys(['START']); gb.doFrame(); }
core.JoyPad = 0xff;
for (let i = 0; i < 200; i++) gb.doFrame();
let sum = 0;
for (let a = 0xc100; a < 0xc400; a++) sum = (sum + gb.getMemory(a, a + 1)[0]) & 0xffff;
console.log('after boot: state', Array.from(gb.getMemory(0xff9b, 0xff9c))[0].toString(16),
  'wram C100 sum', sum.toString(16), 'pc', core.programCounter.toString(16));
