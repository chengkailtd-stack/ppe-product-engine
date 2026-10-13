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
