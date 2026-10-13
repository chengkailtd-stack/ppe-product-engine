// 成楷 PPE 智能引擎 · Node 入口
import { loadData, REPO_ROOT } from './data.js';
import { recommend, validateAnswer, sanitizeAnswer, renderAnswer, renderModelRefs, fallbackAnswer, buildMessages, detectIntent, extractModels, matchScenarios } from './core.js';
import { chat, resolveLLMConfig, PROVIDERS } from './llm.js';

export { loadData, REPO_ROOT, recommend, validateAnswer, sanitizeAnswer, renderAnswer, renderModelRefs, fallbackAnswer, buildMessages, detectIntent, extractModels, matchScenarios, chat, resolveLLMConfig, PROVIDERS };

/**
 * 创建引擎实例
 * @param {{data?: object, root?: string}} opts
 */
export function createEngine(opts = {}) {
  const data = opts.data || loadData(opts.root);
  return {
    data,
    recommend: (q, o) => recommend(data, q, o),
    validate: (answer, o) => validateAnswer(data, answer, o),
    /**
     * 回答一个问题。
     *  - 不传 llm：返回离线规则回答（不需要任何 Key）
     *  - 传 llm（{provider, apiKey, baseURL, model} 或 true 表示读环境变量）：调大模型生成，再做型号硬校验
     *  - 校验不通过：answer 改为规则引擎的确定性回答，不展示被拒原文；原文和校验细节只在 debug: true 时返回
     */
    async ask(question, { llm, fetchImpl, debug = false } = {}) {
      const rec = recommend(data, question);
      // 红线 / 超范围：不交给大模型自由发挥
      if (!llm || rec.band === 'RED') {
        return { source: 'rules', recommendation: rec, answer: renderAnswer(rec), validation: { ok: true, models: [], errors: [] } };
      }
      const cfg = resolveLLMConfig(llm === true ? {} : llm);
      const raw = await chat(buildMessages(data, question, rec), cfg, { fetchImpl });
      const full = validateAnswer(data, raw, { allowed: rec.products.map((p) => p.model) });
      // 默认结果只带错误代码和型号，不带含被拒原句片段的 message
      const validation = { ok: full.ok, models: full.models, errors: full.errors.map(({ code, model }) => (model ? { code, model } : { code })) };
      const out = full.ok
        ? { source: 'llm', recommendation: rec, answer: renderModelRefs(data, raw), validation }
        : { source: 'rules-fallback', recommendation: rec, answer: fallbackAnswer(rec), validation };
      if (debug) out.debug = { raw, validation: full };
      return out;
    },
  };
}
