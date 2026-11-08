// cdp.mjs - a tiny Chrome DevTools Protocol driver for the phone tests (no npm packages: Node 22 has fetch + WebSocket).
// Launches Chrome (or Edge) headless with the GPU on, and gives touch / mouse input, screenshots and page evaluation.
// Used by tests/phone/audit.mjs. Needs Chrome or Edge installed (paths below), or set CHROME_PATH.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export async function launch() {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('No Chrome/Edge found: set CHROME_PATH');
  const dir = mkdtempSync(join(tmpdir(), 'hx-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--enable-gpu',
    '--ignore-gpu-blocklist', '--enable-webgl', ...(process.platform === 'win32' ? ['--use-gl=angle', '--use-angle=d3d11'] : []), 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const { res, rej } = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) rej(new Error(JSON.stringify(d.error))); else res(d.result);
    } else if (d.method === 'Runtime.consoleAPICalled') logs.push(`${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    else if (d.method === 'Log.entryAdded') logs.push(`log ${d.params.entry.level}: ${d.params.entry.text} ${d.params.entry.url || ''}`);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || 'eval error') + '\n  in: ' + expr.slice(0, 200));
    return r.result.value;
  };
  const phone = async (w, h, dpr = 2.625) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true, screenWidth: w, screenHeight: h });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S942B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' });
  };
  const desktop = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  };
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  const tap = async (x, y) => { await touch('touchStart', [{ x, y }]); await sleep(40); await touch('touchEnd', []); };
  const mouseMove = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  const key = async (k, code) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || k, windowsVirtualKeyCode: k === 'Backspace' ? 8 : 0 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || k }); };
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); };
  const goto = async (url, wait = 5500) => { await send('Page.navigate', { url }); await sleep(wait); };
  const close = () => { try { ws.close(); } catch { /* ignore */ } proc.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } };
  return { send, ev, phone, desktop, touch, tap, mouseMove, key, shot, goto, sleep, logs, close };
}
