#!/usr/bin/env node
// 命令行：node engine/bin/ckppe.js "喷漆车间戴什么防护" [--llm] [--provider qwen|deepseek] [--json]
import { createEngine } from '../src/index.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const question = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--provider').join(' ');
if (!question) {
  console.log('用法：ckppe "你的工况或问题" [--llm] [--provider qwen|deepseek] [--json]');
  process.exit(1);
}
const engine = createEngine();
const llm = flag('--llm') ? { provider: opt('--provider') } : undefined;
try {
  const r = await engine.ask(question, { llm });
  if (flag('--json')) console.log(JSON.stringify({ ...r, recommendation: { ...r.recommendation, scenarios: r.recommendation.scenarios.length } }, null, 2));
  else {
    console.log(`[${r.recommendation.band}] 意图：${r.recommendation.intent}  来源：${r.source}\n`);
    console.log(r.answer);
    if (!r.validation.ok) console.log('\n校验问题：', r.validation.errors.map((e) => e.message).join('；'));
  }
} catch (e) {
  console.error('出错：', e.message);
  process.exit(2);
}
