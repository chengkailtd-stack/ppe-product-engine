// 成楷 PPE 智能引擎 · Node 入口
import { loadData, REPO_ROOT } from './data.js';
import { recommend, validateAnswer, sanitizeAnswer, renderAnswer, buildMessages, detectIntent, extractModels, matchScenarios } from './core.js';
import { chat, resolveLLMConfig, PROVIDERS } from './llm.js';

export { loadData, REPO_ROOT, recommend, validateAnswer, sanitizeAnswer, renderAnswer, buildMessages, detectIntent, extractModels, matchScenarios, chat, resolveLLMConfig, PROVIDERS };

/**
 * 创建引擎实例
 * @param {{data?: object, root?: string}} opts
 */
export function createEngine(opts = {}) {
  const data = opts.data || loadData(opts.root);
  return {
    data,
    recommend: (q, o) => recommend(data, q, o),
    validate: (answer) => validateAnswer(data, answer),
    /**
     * 回答一个问题。
     *  - 不传 llm：返回离线规则回答（不需要任何 Key）
     *  - 传 llm（{provider, apiKey, baseURL, model} 或 true 表示读环境变量）：调大模型生成，再做型号硬校验
     */
    async ask(question, { llm, fetchImpl } = {}) {
      const rec = recommend(data, question);
      // 红线 / 超范围：不交给大模型自由发挥
      if (!llm || rec.band === 'RED') {
        return { source: 'rules', recommendation: rec, answer: renderAnswer(rec), validation: { ok: true, models: [], errors: [] } };
      }
      const cfg = resolveLLMConfig(llm === true ? {} : llm);
      const raw = await chat(buildMessages(data, question, rec), cfg, { fetchImpl });
      const validation = validateAnswer(data, raw);
      const answer = validation.ok ? raw : sanitizeAnswer(raw, validation) + '\n\n（部分内容未通过型号/合规校验，已替换为占位，请以成楷客服答复为准。）';
      return { source: 'llm', recommendation: rec, answer, raw, validation };
    },
  };
}
