import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/index.js';
import { resolveLLMConfig, PROVIDERS } from '../src/llm.js';

const engine = createEngine();
const fakeFetch = (content) => async (url, init) => {
  fakeFetch.last = { url, init };
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
};

test('resolveLLMConfig：预设 provider + 环境变量 Key', () => {
  const cfg = resolveLLMConfig({ provider: 'deepseek' }, { DEEPSEEK_API_KEY: 'test-key' });
  assert.equal(cfg.baseURL, PROVIDERS.deepseek.baseURL);
  assert.equal(cfg.model, 'deepseek-chat');
  assert.throws(() => resolveLLMConfig({ provider: 'qwen' }, {}), /API Key/);
});

test('ask 不带 llm：离线规则回答', async () => {
  const r = await engine.ask('车间噪音大用耳塞还是耳罩');
  assert.equal(r.source, 'rules');
  assert.match(r.answer, /CKE-/);
});

test('ask 带 llm：调用 OpenAI 兼容接口并通过校验', async () => {
  const f = fakeFetch('喷漆建议用防毒半面具 CKH-0303，配有机蒸气滤毒盒，以检测报告为准。');
  const r = await engine.ask('喷漆车间戴什么', { llm: { baseURL: 'https://example.invalid/v1', model: 'm', apiKey: 'k' }, fetchImpl: f });
  assert.equal(r.source, 'llm');
  assert.equal(r.validation.ok, true);
  assert.equal(fakeFetch.last.url, 'https://example.invalid/v1/chat/completions');
  assert.equal(JSON.parse(fakeFetch.last.init.body).model, 'm');
});

test('ask 带 llm：大模型编造型号会被替换', async () => {
  const f = fakeFetch('推荐 CKH-6200 防毒面具，只要 59 元。');
  const r = await engine.ask('喷漆车间戴什么', { llm: { baseURL: 'https://example.invalid/v1', model: 'm', apiKey: 'k' }, fetchImpl: f });
  assert.equal(r.validation.ok, false);
  assert.ok(!r.answer.includes('CKH-6200'));
});

test('ask：红线问题不交给大模型', async () => {
  let called = false;
  const f = async () => { called = true; throw new Error('should not call'); };
  const r = await engine.ask('进有限空间作业戴什么口罩', { llm: { baseURL: 'https://x/v1', model: 'm', apiKey: 'k' }, fetchImpl: f });
  assert.equal(called, false);
  assert.equal(r.recommendation.band, 'RED');
});

const LLM = { baseURL: 'https://example.invalid/v1', model: 'm', apiKey: 'k' };

test('ask：校验失败时不展示被拒原文，改为规则引擎回退；raw 只在 debug 下返回', async () => {
  const bad = '只要59元，100%安全，报告编号ABC12345。';
  const r = await engine.ask('喷漆车间戴什么', { llm: LLM, fetchImpl: fakeFetch(bad) });
  assert.equal(r.validation.ok, false);
  assert.equal(r.source, 'rules-fallback');
  for (const w of ['59元', '100%', 'ABC12345']) assert.ok(!r.answer.includes(w), w);
  assert.equal(r.raw, undefined);
  assert.equal(r.debug, undefined);
  assert.ok(!JSON.stringify(r).includes('ABC12345'), '默认结果任何字段都不得带被拒原句');
  const d = await engine.ask('喷漆车间戴什么', { llm: LLM, fetchImpl: fakeFetch(bad), debug: true });
  assert.equal(d.debug.raw, bad);
  assert.ok(!d.answer.includes('ABC12345'));
});

test('ask：候选集合外型号拒绝（即使在总库）', async () => {
  const r = await engine.ask('喷漆车间戴什么', { llm: LLM, fetchImpl: fakeFetch('喷漆推荐 CKH-9500B。') });
  assert.equal(r.validation.ok, false);
  assert.ok(r.validation.errors.some((e) => e.code === 'NOT_CANDIDATE' && e.model === 'CKH-9500B'));
  assert.ok(!r.answer.includes('CKH-9500B'));
});

test('ask：空候选时出现任何型号都拒绝', async () => {
  assert.equal(engine.recommend('冷库防寒手套怎么选').products.length, 0);
  const r = await engine.ask('冷库防寒手套怎么选', { llm: LLM, fetchImpl: fakeFetch('推荐 CKS-CUTRE-PU，保暖又耐磨。') });
  assert.equal(r.validation.ok, false);
  assert.ok(r.validation.errors.some((e) => e.code === 'NOT_CANDIDATE'));
  assert.ok(!r.answer.includes('CKS-CUTRE-PU'));
});

test('ask：型号后置品类描述不符被拦（CKB-2112 是防毒面具）', async () => {
  const q = '电焊工全套劳保怎么配';
  assert.ok(engine.recommend(q).products.some((p) => p.model === 'CKB-2112'));
  for (const bad of ['CKB-2112 是防毒面具。', '推荐 CKB-2112，它是防毒面具。', '推荐 CKB-2112。它可以当防毒面具用。']) {
    const r = await engine.ask(q, { llm: LLM, fetchImpl: fakeFetch(bad) });
    assert.equal(r.validation.ok, false, bad);
    assert.ok(r.validation.errors.some((e) => e.code === 'PREFIX_CONTEXT_MISMATCH'), bad);
  }
});

test('ask：[[型号]] 占位按产品表权威品名渲染', async () => {
  const r = await engine.ask('喷漆车间戴什么', { llm: LLM, fetchImpl: fakeFetch('喷漆建议 [[CKH-0303]]，配有机蒸气滤毒盒，以检测报告为准。') });
  assert.equal(r.validation.ok, true, JSON.stringify(r.validation.errors));
  assert.ok(r.answer.includes('CKH-0303（软硅胶防毒半面具（双滤盒），呼吸防护）'));
});
