// 使い方: node render-test.mjs <html> <outDir> [width] [height] [fontSize] [ids(csv)]
// Playwright 同梱の headless chromium（環境変数 HEADLESS_SHELL で実行ファイルを指定可）を CDP で直接操作し、
// 画面ごとのスクリーンショットと配置検証を行う。依存パッケージなし（Node 22+ の fetch / WebSocket を使用）。
// 例: node _build/render-test.mjs scoa-trainer.html /tmp/shots 375 553 m ron-001,eig-073
//   → 375x553（iPhone SE系でSafariのツールバーが出ている実効高さ）・文字サイズ中で、指定IDの問題を解いて検証
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const BIN = process.env.HEADLESS_SHELL || '/Users/kuriyagawayusuke/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const [htmlPath, outDir] = process.argv.slice(2);
const W = +(process.argv[4] || 375), H = +(process.argv[5] || 667);
const fontSize = process.argv[6] || 'm';
const ids = (process.argv[7] || '').split(',').filter(Boolean);
fs.mkdirSync(outDir, { recursive: true });
const proc = spawn(BIN, ['--headless', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--window-size=' + W + ',' + H, 'about:blank']);
const port = await new Promise((res, rej) => { let buf = ''; proc.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(buf); if (m) res(+m[1]); }); setTimeout(() => rej(new Error('devtools起動せず: ' + buf)), 15000); });
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let mid = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) { listeners.slice().forEach((l) => l(m)); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const waitEvent = (name) => new Promise((res) => { const l = (m) => { if (m.method === name) { listeners.splice(listeners.indexOf(l), 1); res(m.params); } }; listeners.push(l); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails))); return r.result.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.data, 'base64')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = {};
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  const url = 'file://' + path.resolve(htmlPath);
  let load = waitEvent('Page.loadEventFired'); await send('Page.navigate', { url }); await load;
  const state = { v: 1, stats: {}, history: [], days: {}, resume: ids.length ? { mode: 'field', label: 'レイアウト検証', ids, idx: 0, log: [], startedAt: Date.now(), overallEndAt: null } : null, settings: { limitSec: 30, timerOn: true, shuffleOpts: false, instantExp: true, theme: 'dark', fontSize }, lastExportAt: null, exportSnoozeUntil: null, hideAddToHome: true };
  await evalJS(`localStorage.setItem('scoa-trainer-v1', ${JSON.stringify(JSON.stringify(state))}); 'ok'`);
  load = waitEvent('Page.loadEventFired'); await send('Page.reload'); await load;
  await sleep(200);
  await shot('01-home');
  report.home = await evalJS(`(()=>{const a=document.querySelector('.hub-link a'); return {hubLink: !!a, hubHref: a&&a.getAttribute('href'), resumeVisible: !document.getElementById('resumeBox').hidden, nQ: (window.__n||null)}})()`);
  await evalJS(`document.getElementById('btnFields').click(); 'ok'`); await sleep(100); await shot('02-fields');
  report.fields = await evalJS(`(()=>{const b=document.querySelector('#view-fields .homebtn'); const r=b.getBoundingClientRect(); return {homeBtn: !!b, inView: r.right<=innerWidth && r.top>=0, text:b.textContent.trim()}})()`);
  await evalJS(`document.querySelectorAll('#fieldsList .field-row')[0].click(); 'ok'`); await sleep(80); await shot('02b-fields-sub');
  report.fieldsSubHome = await evalJS(`(()=>{document.querySelector('#view-fields .homebtn').click(); return !document.getElementById('view-home').hidden})()`);
  await evalJS(`document.getElementById('btnStats').click(); 'ok'`); await sleep(100); await shot('03-stats');
  report.statsHome = await evalJS(`(()=>{document.querySelector('#view-stats .homebtn').click(); return !document.getElementById('view-home').hidden})()`);
  await evalJS(`document.getElementById('btnSettings').click(); 'ok'`); await sleep(100); await shot('04-settings');
  report.settingsHome = await evalJS(`(()=>{document.querySelector('#view-settings .homebtn').click(); return !document.getElementById('view-home').hidden})()`);
  if (ids.length) await evalJS(`document.getElementById('btnResume').click(); 'ok'`); else await evalJS(`document.getElementById('btnQuick10').click(); 'ok'`);
  await sleep(150); await shot('05-quiz-before');
  report.quizBefore = await evalJS(`(()=>{const sc=document.getElementById('quizScroll'); const opts=[...document.querySelectorAll('#opts .opt-btn')].map(b=>b.getBoundingClientRect()); const hb=document.getElementById('quizAbort').getBoundingClientRect(); return {qid: document.getElementById('hudCat').textContent, homeBtnInView: hb.top>=0&&hb.right<=innerWidth, optsInView: opts.every(r=>r.top>=0&&r.bottom<=innerHeight), qScrollH: sc.clientHeight, answerAreaParent: document.getElementById('answerArea').parentNode.id}})()`);
  await evalJS(`document.querySelectorAll('#opts .opt-btn')[1].click(); 'ok'`); await sleep(250); await shot('06-quiz-after');
  report.quizAfter = await evalJS(`(()=>{const sc=document.getElementById('quizScroll'); const scR=sc.getBoundingClientRect(); const fb=document.getElementById('feedback'); const v=fb.querySelector('.fb-verdict').getBoundingClientRect(); const e=fb.querySelector('.fb-e'); const eR=e&&e.getBoundingClientRect(); const k=fb.querySelector('.fb-k'); const kR=k&&k.getBoundingClientRect(); const nb=document.getElementById('nextBtn').getBoundingClientRect(); const vis=r=>!!r&&r.bottom>scR.top&&r.top<scR.bottom; const fully=r=>!!r&&r.top>=scR.top-1&&r.bottom<=scR.bottom+1; return {answerAreaParent: document.getElementById('answerArea').parentNode.id, scrollTop: Math.round(sc.scrollTop), scrollH: sc.scrollHeight, clientH: sc.clientHeight, verdictFully: fully(v), expFully: fully(eR), expVisible: vis(eR), expHeight: eR&&Math.round(eR.height), kExists: !!k, kVisible: vis(kR), kFully: fully(kR), nextInView: nb.top>=0&&nb.bottom<=innerHeight, nextText: document.getElementById('nextBtn').textContent, feedbackH: fb.offsetHeight}})()`);
  await evalJS(`(()=>{const sc=document.getElementById('quizScroll'); sc.scrollTop=sc.scrollHeight; return 'ok'})()`); await sleep(100); await shot('07-quiz-after-scrolled');
  report.quizAfterScrolled = await evalJS(`(()=>{const sc=document.getElementById('quizScroll'); const scR=sc.getBoundingClientRect(); const k=document.querySelector('#feedback .fb-k'); const kR=k&&k.getBoundingClientRect(); return {kFully: !!kR&&kR.top>=scR.top-1&&kR.bottom<=scR.bottom+1}})()`);
  await evalJS(`document.getElementById('nextBtn').click(); 'ok'`); await sleep(150);
  const view = await evalJS(`[...document.querySelectorAll('.view')].find(v=>!v.hidden).id`);
  if (view === 'view-quiz') {
    await shot('08-quiz-next');
    report.quizNext = await evalJS(`(()=>{const opts=[...document.querySelectorAll('#opts .opt-btn')].map(b=>b.getBoundingClientRect()); return {answerAreaParent: document.getElementById('answerArea').parentNode.id, optsInView: opts.every(r=>r.top>=0&&r.bottom<=innerHeight), feedbackHidden: document.getElementById('feedback').hidden}})()`);
    report.quizHome = await evalJS(`(()=>{ window.confirm=()=>true; document.getElementById('quizAbort').click(); return !document.getElementById('view-home').hidden })()`);
    await shot('09-home-after-abort');
    report.resumeAfterAbort = await evalJS(`!document.getElementById('resumeBox').hidden`);
  } else {
    await shot('08-result');
    report.result = await evalJS(`(()=>{const b=document.querySelector('#view-result .homebtn'); b.click(); return {homeBtn: !!b, backHome: !document.getElementById('view-home').hidden}})()`);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (e) { console.error('ERROR', e); process.exitCode = 1; }
finally { try { ws.close(); } catch {} proc.kill(); }
