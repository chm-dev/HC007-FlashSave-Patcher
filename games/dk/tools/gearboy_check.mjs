#!/usr/bin/env node
/*
 * Run a ROM in Gearboy (headless MCP) through the title -> Select File route
 * and report PC / screenshots.  Gearboy is stricter than serverboy about the
 * mapper and uninitialised RAM, so it can reproduce hardware freezes the
 * serverboy tests miss.
 *
 *   node games/dk/tools/gearboy_check.mjs <rom> [out-prefix] [--sram file] [--taps N]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const rom = path.resolve(args[0]);
const prefix = args[1] && !args[1].startsWith('--') ? args[1] : rom.replace(/\.gb$/i, '');
const taps = Number((args.find((a, i) => args[i - 1] === '--taps')) || 2);
const exe = path.join(root, 'tools', 'gearboy', 'Gearboy.exe');

const child = spawn(exe, ['--headless', '--mcp-stdio', '--portable', rom], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', nextId = 1; const waiters = new Map();
child.stdout.on('data', (c) => {
  buf += c.toString('utf8'); let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== undefined && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  }
});
const rpc = (method, params) => new Promise((res, rej) => {
  const id = nextId++; const t = setTimeout(() => rej(new Error(`${method} timeout`)), 120000);
  waiters.set(id, (m) => { clearTimeout(t); res(m.result ?? m.error); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
});
async function call(name, a) {
  const r = await rpc('tools/call', { name, arguments: a || {} });
  const text = r?.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (!text) return r; try { return JSON.parse(text); } catch { return text; }
}
const step = async (n) => { while (n > 0) { const k = Math.min(1000, n); await call('debug_step_frame', { frames: k, mode: 'sync' }); n -= k; } };
async function shot(name) {
  const r = await rpc('tools/call', { name: 'get_screenshot', arguments: {} });
  for (const c of (r?.content || [])) if (c.type === 'image' && c.data) { fs.writeFileSync(`${prefix}-${name}.png`, Buffer.from(c.data, 'base64')); return `${prefix}-${name}.png`; }
  return 'none';
}
async function pc() { const c = await call('get_cpu_status'); return typeof c === 'string' ? c.slice(0, 160) : JSON.stringify(c).slice(0, 220); }
async function press(button, frames = 4) {
  await call('controller_button', { player: 1, button, action: 'press' });
  await step(frames);
  await call('controller_button', { player: 1, button, action: 'release' });
}

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dk-check', version: '1' } });
await rpc('notifications/initialized', {});
const media = await call('get_media_info');
console.log('media:', JSON.stringify(media).slice(0, 200));
await step(300);
console.log('title   :', await shot('1-title'), '|', await pc());
for (let i = 0; i < taps; i++) {
  await press('start');
  await step(400);
  console.log(`after START #${i + 1}:`, await shot(`2-start${i + 1}`), '|', await pc());
}
await step(300);
console.log('settled :', await shot('3-settled'), '|', await pc());
child.kill();
