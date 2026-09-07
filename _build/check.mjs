// バンク検査スクリプト  使い方: node _build/check.mjs [ファイル名...]
// 引数なしで _build/bank/*.js を全部検査する
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const DIR = new URL('./bank/', import.meta.url).pathname;
const RANGE = {
  'gengo.js':   ['gen', 1, 65,  65, '言語'],
  'suriA.js':   ['suri', 1, 50, 50, '数理'],
  'suriB.js':   ['suri', 51, 95, 45, '数理'],
  'ronriA.js':  ['ron', 1, 50,  50, '論理'],
  'ronriB.js':  ['ron', 51, 95, 45, '論理'],
  'joshiki.js': ['jos', 1, 70,  70, '常識'],
  'eigoA.js':   ['eig', 1, 50,  50, '英語'],
  'eigoB.js':   ['eig', 51, 95, 45, '英語'],
};

function load(file) {
  const src = readFileSync(join(DIR, file), 'utf8');
  const g = { window: {} };
  new Function('window', src).call(g, g.window);
  const arr = Object.values(g.window)[0];
  if (!Array.isArray(arr)) throw new Error('配列が取り出せません');
  return arr;
}

const files = process.argv.slice(2).map(f => basename(f));
const targets = files.length ? files : readdirSync(DIR).filter(f => f.endsWith('.js')).sort();

let totalProblems = 0, grand = 0;

for (const file of targets) {
  const spec = RANGE[file];
  let b;
  try { b = load(file); }
  catch (e) { console.log(`\n### ${file}\n  読み込み失敗: ${e.message}`); totalProblems++; continue; }
  grand += b.length;

  const p = [];
  const ids = b.map(x => x.id);
  const dup = b.length - new Set(ids).size;
  if (dup) p.push(`ID重複 ${dup}件`);

  if (spec) {
    const [pre, lo, hi, want, cat] = spec;
    if (b.length !== want) p.push(`問題数 ${b.length}（期待 ${want}）`);
    const bad = ids.filter(i => {
      const m = /^(.+)-(\d+)$/.exec(i);
      if (!m || m[1] !== pre) return true;
      const n = +m[2];
      return n < lo || n > hi;
    });
    if (bad.length) p.push(`ID範囲外 ${bad.length}件 (${bad.slice(0, 3).join(',')})`);
    const wc = b.filter(x => x.cat !== cat).length;
    if (wc) p.push(`cat不正 ${wc}件`);
  }

  const badOpts = b.filter(x => !Array.isArray(x.o) || x.o.length !== 4
    || new Set(x.o).size !== 4 || x.o.some(o => typeof o !== 'string' || !o.trim()));
  if (badOpts.length) p.push(`選択肢不正 ${badOpts.length}件 (${badOpts.slice(0,3).map(x=>x.id)})`);

  const badA = b.filter(x => !Number.isInteger(x.a) || x.a < 0 || x.a > 3);
  if (badA.length) p.push(`正解index不正 ${badA.length}件 (${badA.slice(0,3).map(x=>x.id)})`);

  const noE = b.filter(x => !x.e || !x.e.trim());
  if (noE.length) p.push(`解説なし ${noE.length}件 (${noE.slice(0,3).map(x=>x.id)})`);

  const noK = b.filter(x => !x.k || !x.k.trim());
  if (noK.length) p.push(`関連知識(k)なし ${noK.length}件 (${noK.slice(0,3).map(x=>x.id)})`);
  const badK = b.filter(x => x.k && (x.k.replace(/\n/g, '').length > 240 || /<[a-z\/]|\*\*/.test(x.k)));
  if (badK.length) p.push(`関連知識(k)が長すぎ/記法混入 ${badK.length}件 (${badK.slice(0,3).map(x=>x.id)})`);
  const kEqE = b.filter(x => x.k && x.e && x.k.trim() === x.e.trim());
  if (kEqE.length) p.push(`関連知識(k)が解説と同一 ${kEqE.length}件`);

  const noX = b.filter(x => !Array.isArray(x.x) || x.x.length !== 4 || x.x.some(v => typeof v !== 'string' || !v.trim()));
  if (noX.length) p.push(`選択肢別解説(x)なし/不正 ${noX.length}件 (${noX.slice(0,3).map(x=>x.id)})`);
  const longX = b.filter(x => Array.isArray(x.x) && x.x.some(v => typeof v === 'string' && v.length > 70));
  if (longX.length) p.push(`選択肢別解説(x)が70字超 ${longX.length}件 (${longX.slice(0,3).map(x=>x.id)})`);
  const noSub = b.filter(x => !x.sub || !x.sub.trim());
  if (noSub.length) p.push(`sub欠落 ${noSub.length}件`);

  const badLv = b.filter(x => ![1, 2, 3].includes(x.lv));
  if (badLv.length) p.push(`lv不正 ${badLv.length}件`);

  const noQ = b.filter(x => !x.q || !x.q.trim());
  if (noQ.length) p.push(`設問文なし ${noQ.length}件`);

  const dist = [0, 1, 2, 3].map(i => b.filter(x => x.a === i).length);
  const lo2 = b.length * 0.18, hi2 = b.length * 0.32;
  if (dist.some(d => d < lo2 || d > hi2)) p.push(`正解位置の偏り ${JSON.stringify(dist)}`);

  // 中身が完全に同じ問題の重複（設問文が定型で選択肢だけ違うものは正常なので選択肢も鍵に含める）
  const qs = {};
  b.forEach(x => {
    const k = [x.q, x.s || '', JSON.stringify(x.tbl || null), x.o.join('')].join('|');
    (qs[k] = qs[k] || []).push(x.id);
  });
  const dupQ = Object.values(qs).filter(v => v.length > 1);
  if (dupQ.length) p.push(`内容が同一の問題 ${dupQ.length}組 (${dupQ.slice(0,3).map(v=>v.join('='))})`);

  // tbl 構造
  const badTbl = b.filter(x => x.tbl && (!Array.isArray(x.tbl.head) || !Array.isArray(x.tbl.rows)
    || x.tbl.rows.some(r => !Array.isArray(r) || r.length !== x.tbl.head.length)));
  if (badTbl.length) p.push(`tbl構造不正 ${badTbl.length}件 (${badTbl.slice(0,3).map(x=>x.id)})`);

  const subs = {};
  b.forEach(x => { subs[x.sub] = (subs[x.sub] || 0) + 1; });
  const lv = [1, 2, 3].map(i => b.filter(x => x.lv === i).length);

  console.log(`\n### ${file}  n=${b.length}  aDist=${JSON.stringify(dist)}  lv=${JSON.stringify(lv)}`);
  console.log(`  sub: ${Object.entries(subs).map(([k, v]) => `${k}${v}`).join(' / ')}`);
  if (p.length) { console.log(`  ⚠ ${p.join('\n  ⚠ ')}`); totalProblems += p.length; }
  else console.log('  ✅ 問題なし');
}

// 全ファイル横断のID重複
if (!files.length) {
  const all = [];
  for (const f of targets) { try { all.push(...load(f)); } catch {} }
  const seen = new Map();
  const cross = [];
  all.forEach(x => { if (seen.has(x.id)) cross.push(x.id); else seen.set(x.id, 1); });
  console.log(`\n=== 合計 ${grand}問 / ファイル横断ID重複 ${cross.length}件 ${cross.slice(0,5).join(',')} ===`);
  if (cross.length) totalProblems++;
}

console.log(totalProblems ? `\n指摘 ${totalProblems}件` : '\n全ファイル合格');
process.exit(totalProblems ? 1 : 0);
