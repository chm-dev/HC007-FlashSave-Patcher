#!/usr/bin/env node
/*
 * Minimal Gearboy MCP client example for this project.
 *
 *   node tools/gearboy_mcp_example.mjs [rom]
 *
 * Boots the ROM headless, steps 300 frames, prints media/CPU info, reads the
 * first 16 bytes of WRAM (area 6) and writes a screenshot next to the ROM.
 *
 * Gearboy's MCP server speaks JSON-RPC 2.0 over stdio.  Tool names in this
 * build: get_media_info, debug_step_frame, read_memory, get_cpu_status,
 * get_screenshot, controller_button, save_state/load_state, ...
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rom = path.resolve(root, process.argv[2] || 'roms/mapperprobe-mbc5.gb');
const exe = path.join(root, 'tools', 'gearboy', 'Gearboy.exe');

if (!fs.existsSync(exe)) throw new Error(`Gearboy not found at ${exe}`);
if (!fs.existsSync(rom)) throw new Error(`ROM not found at ${rom}`);

const child = spawn(exe, ['--headless', '--mcp-stdio', '--portable', rom], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderrBuf = '';
child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

let buf = '';
const waiters = new Map();
let nextId = 1;
child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && waiters.has(msg.id)) {
      waiters.get(msg.id)(msg);
      waiters.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new Error(`${method} timed out`));
    }, 120000);
    waiters.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg.result ?? msg.error);
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id, method, params: params || {},
    }) + '\n');
  });
}

async function call(name, args) {
  const r = await rpc('tools/call', { name, arguments: args || {} });
  const text = r?.content?.filter((c) => c.type === 'text')
    .map((c) => c.text).join('\n');
  if (!text) return r;
  try { return JSON.parse(text); } catch { return text; }
}

async function step(frames) {
  let left = frames;
  while (left > 0) {
    const n = Math.min(1000, left);
    await call('debug_step_frame', { frames: n, mode: 'sync' });
    left -= n;
  }
}

function saveScreenshot(result, file) {
  for (const c of (result?.content || [])) {
    if (c.type === 'image' && c.data) {
      fs.writeFileSync(file, Buffer.from(c.data, 'base64'));
      return true;
    }
  }
  return false;
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'hc007-probe', version: '1' },
  });
  await rpc('notifications/initialized', {});

  const media = await call('get_media_info');
  console.log('media:', media.file_name || media.path, 'valid=', media.valid_rom);

  await step(300);

  const cpu = await call('get_cpu_status');
  console.log('cpu:', JSON.stringify(cpu).slice(0, 200));

  /* area 6 = the full 8 KiB WRAM (0xC000-0xDFFF). */
  const wram = await call('read_memory', { area: 6, offset: '0000', size: 16 });
  console.log('WRAM C000:', wram.data);

  const shot = await rpc('tools/call', { name: 'get_screenshot', arguments: {} });
  const png = rom.replace(/\.(gb|gbc)$/i, '') + '-shot.png';
  console.log(saveScreenshot(shot, png) ? `screenshot: ${png}` : 'screenshot: none');

  if (stderrBuf.trim()) console.log('stderr:', stderrBuf.trim().slice(-300));
}

main().catch((err) => console.error('ERR', err)).finally(() => {
  child.kill();
  setTimeout(() => process.exit(0), 500);
});
