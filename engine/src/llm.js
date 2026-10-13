// 大模型接入：OpenAI 兼容的 /chat/completions 接口，用户自带 API Key。
// 本仓库不内置、不保存任何 Key；Key 只从参数或环境变量读取。

export const PROVIDERS = {
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyEnv: 'DASHSCOPE_API_KEY' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyEnv: 'DEEPSEEK_API_KEY' },
};

/**
 * 解析大模型配置。优先级：显式参数 > CKPPE_* 环境变量 > 预设 provider
 * @param {{provider?: string, baseURL?: string, model?: string, apiKey?: string}} opts
 */
export function resolveLLMConfig(opts = {}, env = process.env) {
  const preset = PROVIDERS[opts.provider || env.CKPPE_PROVIDER || 'qwen'] || {};
  const cfg = {
    baseURL: (opts.baseURL || env.CKPPE_BASE_URL || preset.baseURL || '').replace(/\/+$/, ''),
    model: opts.model || env.CKPPE_MODEL || preset.model,
    apiKey: opts.apiKey || env.CKPPE_API_KEY || (preset.keyEnv ? env[preset.keyEnv] : undefined),
  };
  if (!cfg.apiKey) throw new Error('缺少 API Key：请设置 CKPPE_API_KEY（或 DASHSCOPE_API_KEY / DEEPSEEK_API_KEY）');
  if (!cfg.baseURL || !cfg.model) throw new Error('缺少 baseURL 或 model 配置');
  return cfg;
}

/** 调用 OpenAI 兼容接口，返回回答文本 */
export async function chat(messages, cfg, { fetchImpl = globalThis.fetch, temperature = 0.3, timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, temperature, messages }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`大模型接口返回 HTTP ${res.status}`);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('大模型返回格式不符合 OpenAI 兼容接口');
    return text;
  } finally {
    clearTimeout(timer);
  }
}
