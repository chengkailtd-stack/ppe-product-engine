#!/usr/bin/env node
// 金标准题集打分：node eval/run.mjs [--llm] [--provider qwen|deepseek] [--verbose]
//  - 默认离线：评估规则引擎的 意图/风险等级/品类/推荐型号
//  - --llm：额外调用大模型，评估回答是否通过型号硬校验与红线
// 硬门（hard=true）全部通过才算合格，退出码非 0 表示不合格。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../engine/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const useLLM = args.includes('--llm');
const verbose = args.includes('--verbose');
const pi = args.indexOf('--provider');
const llm = useLLM ? { provider: pi >= 0 ? args[pi + 1] : undefined } : undefined;

const cases = readFileSync(join(here, 'golden.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const engine = createEngine();

function check(c, r) {
  const rec = r.recommendation;
  const models = rec.products.map((p) => p.model);
  const fails = [];
  if (c.expect_band && !c.expect_band.includes(rec.band)) fails.push(`风险等级 ${rec.band} ∉ ${c.expect_band}`);
  if (c.expect_intent && rec.intent !== c.expect_intent) fails.push(`意图 ${rec.intent} ≠ ${c.expect_intent}`);
  for (const cat of c.expect_categories || []) if (!rec.categories.includes(cat)) fails.push(`缺品类 ${cat}`);
  if (c.expect_any_model && !c.expect_any_model.some((m) => models.includes(m))) fails.push(`未推荐 ${c.expect_any_model.join('/')} 中任一`);
  for (const m of c.must_not_model || []) if (models.includes(m)) fails.push(`不应推荐 ${m}`);
  for (const pre of c.must_not_prefix || []) if (models.some((m) => m.startsWith(pre + '-'))) fails.push(`不应推荐 ${pre} 前缀`);
  if (c.only_prefix && models.some((m) => !c.only_prefix.some((p) => m.startsWith(p + '-')))) fails.push(`出现 ${c.only_prefix} 以外的前缀`);
  if (c.max_products !== undefined && models.length > c.max_products) fails.push(`推荐了 ${models.length} 个型号（上限 ${c.max_products}）`);
  for (const w of c.must_not_answer || []) if (r.answer.includes(w)) fails.push(`回答含禁用内容「${w}」`);
  if (!r.validation.ok) fails.push(`回答校验不过：${r.validation.errors.map((e) => e.code).join(',')}`);
  return fails;
}

let pass = 0, hardFail = 0;
const rows = [];
for (const c of cases) {
  let r;
  try {
    r = await engine.ask(c.question, { llm });
  } catch (e) {
    rows.push({ id: c.id, ok: false, hard: c.hard, fails: [`出错：${e.message}`] });
    if (c.hard) hardFail++;
    continue;
  }
  const fails = check(c, r);
  const ok = fails.length === 0;
  if (ok) pass++;
  else if (c.hard) hardFail++;
  rows.push({ id: c.id, ok, hard: c.hard, fails, band: r.recommendation.band, question: c.question });
}

for (const x of rows) {
  if (!x.ok || verbose) console.log(`${x.ok ? '✓' : '✗'} ${x.id}${x.hard ? ' [硬门]' : ''} ${x.question || ''}${x.fails.length ? '\n    ' + x.fails.join('；') : ''}`);
}
const hardTotal = cases.filter((c) => c.hard).length;
console.log(`\n模式：${useLLM ? '大模型' : '离线规则'}  总分 ${pass}/${cases.length}（${((pass / cases.length) * 100).toFixed(1)}%）  硬门 ${hardTotal - hardFail}/${hardTotal}`);
process.exit(hardFail ? 1 : 0);
