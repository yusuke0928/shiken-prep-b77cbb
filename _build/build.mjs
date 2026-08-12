#!/usr/bin/env node
// _build/build.mjs
// _build/bank/*.js のバンク定義を app-shell.html に注入し、
// リポジトリ直下に scoa-trainer.html を生成する。依存ゼロ。
// バンクファイルは eval / new Function で評価せず、単純な文字列走査のみで
// window.BANK_xxx = [ ... ]; の配列リテラル部分を抜き出す。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const BANK_DIR = process.env.SCOA_BANK_DIR
  ? path.resolve(process.env.SCOA_BANK_DIR)
  : path.join(__dirname, 'bank');
const SHELL_FILE = path.join(__dirname, 'app-shell.html');
const OUT_FILE = process.env.SCOA_OUT_FILE
  ? path.resolve(process.env.SCOA_OUT_FILE)
  : path.join(REPO_ROOT, 'scoa-trainer.html');

const INJECT_MARK = '/*__BANK_INJECT__*/';
const KNOWN_CATS = ['言語', '数理', '論理', '常識', '英語'];

// 文字列リテラルを考慮しつつ、開始 '[' から対応する ']' までを抜き出す。
function extractArrayLiteral(text, startIdx) {
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) { escaped = false; }
      else if (ch === '\\') { escaped = true; }
      else if (ch === inStr) { inStr = null; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '[') { depth++; continue; }
    if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
      continue;
    }
  }
  throw new Error('配列リテラルに対応する ] が見つかりません（' + startIdx + '文字目以降）');
}

// window.BANK_xxx = [ ... ]; の [ ... ] 部分の中身（前後の[]を除いた文字列）を返す。
function extractBankInner(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const re = /window\.BANK_[A-Za-z0-9_]+\s*=\s*\[/;
  const m = re.exec(text);
  if (!m) {
    throw new Error('window.BANK_xxx = [ ... ]; の形式が見つかりません');
  }
  const bracketStart = m.index + m[0].length - 1; // '[' の位置
  const arrLiteral = extractArrayLiteral(text, bracketStart);
  return arrLiteral.slice(1, -1).trim(); // 前後の [ ] を除去
}

function countIdOccurrences(text) {
  const re = /\bid\s*:\s*['"]/g;
  return (text.match(re) || []).length;
}

function extractIds(text) {
  const re = /\bid\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  const ids = [];
  let m;
  while ((m = re.exec(text))) ids.push(m[2]);
  return ids;
}

function extractCatCounts(text) {
  const re = /\bcat\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  const counts = {};
  let m;
  while ((m = re.exec(text))) counts[m[2]] = (counts[m[2]] || 0) + 1;
  return counts;
}

function main() {
  if (!fs.existsSync(SHELL_FILE)) {
    console.error('[build] app-shell.html が見つかりません: ' + SHELL_FILE);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(BANK_DIR)) {
    console.log('[build] バンクディレクトリが存在しません: ' + BANK_DIR);
    console.log('[build] 問題バンクが無いため scoa-trainer.html は生成しませんでした。');
    return;
  }

  const files = fs.readdirSync(BANK_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();

  if (files.length === 0) {
    console.log('[build] ' + BANK_DIR + ' に .js ファイルが1つもありません。');
    console.log('[build] 問題バンクが無いため scoa-trainer.html は生成しませんでした。');
    return;
  }

  const chunks = [];
  const failedFiles = [];
  for (const f of files) {
    const full = path.join(BANK_DIR, f);
    try {
      const inner = extractBankInner(full);
      const n = countIdOccurrences(inner);
      if (inner) chunks.push(inner);
      console.log('[build] 取り込み: ' + f + '（' + n + '問）');
    } catch (err) {
      failedFiles.push(f);
      console.error('[build] 警告: ' + f + ' の読み込みに失敗しました: ' + err.message);
    }
  }

  if (chunks.length === 0) {
    console.log('[build] 有効なバンクファイルが1件もありませんでした。scoa-trainer.html は生成しませんでした。');
    return;
  }

  const combined = chunks.join(',\n');
  const allQText = 'const ALL_Q = [\n' + combined + '\n];';

  const shell = fs.readFileSync(SHELL_FILE, 'utf8');
  if (!shell.includes(INJECT_MARK)) {
    console.error('[build] app-shell.html に ' + INJECT_MARK + ' が見つかりません。');
    process.exitCode = 1;
    return;
  }
  const output = shell.replace(INJECT_MARK, () => allQText);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, output, 'utf8');

  // --- 集計 ---
  const ids = extractIds(combined);
  const dupCount = ids.length - new Set(ids).size;
  const catCounts = extractCatCounts(combined);

  console.log('');
  console.log('[build] 出力: ' + OUT_FILE);
  console.log('[build] 総問題数: ' + ids.length);
  console.log('[build] 尺度別内訳: ' + KNOWN_CATS.map((c) => c + ':' + (catCounts[c] || 0)).join(' / '));
  const otherCats = Object.keys(catCounts).filter((c) => !KNOWN_CATS.includes(c));
  if (otherCats.length) {
    console.log('[build] 未知のcat: ' + otherCats.map((c) => c + ':' + catCounts[c]).join(' / '));
  }
  console.log('[build] ID重複数: ' + dupCount);
  if (dupCount > 0) {
    const seen = new Set();
    const dups = new Set();
    ids.forEach((id) => { if (seen.has(id)) dups.add(id); else seen.add(id); });
    const list = [...dups];
    console.log('[build] 重複ID: ' + list.slice(0, 20).join(', ') + (list.length > 20 ? ' ...' : ''));
  }
  if (failedFiles.length) {
    console.log('[build] 読み込み失敗ファイル: ' + failedFiles.join(', '));
  }
}

main();
