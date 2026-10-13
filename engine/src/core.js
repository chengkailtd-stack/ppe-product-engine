// 成楷 PPE 智能引擎 · 核心逻辑（纯函数，无 I/O、无第三方依赖，浏览器和 Node 通用）
// 数据 data = { products, standards, scenes, rules: { prefix, redlines, substitution, hazards } }

export const MODEL_RE = /CK[A-Z]-[0-9A-Z][0-9A-Z-]*/gi;

const uniq = (arr) => [...new Set(arr)];
const lower = (s) => String(s || '').toLowerCase();
const has = (text, kw) => lower(text).includes(lower(kw));

// ---------------- 型号 ----------------

/** 从文本中抽出所有成楷型号（大写、去重、去掉尾部连字符） */
export function extractModels(text) {
  const out = [];
  for (const m of String(text || '').matchAll(MODEL_RE)) out.push(m[0].toUpperCase().replace(/-+$/, ''));
  return uniq(out);
}

export function prefixOf(model) {
  const m = /^(CK[A-Z])-/i.exec(String(model || ''));
  return m ? m[1].toUpperCase() : null;
}

/** 前缀与品类是否自洽 */
export function prefixAllows(prefixRules, model, category) {
  const p = prefixRules.prefixes[prefixOf(model)];
  return !!p && p.allowed_categories.includes(category);
}

function productIndex(data) {
  const idx = new Map();
  for (const p of data.products) idx.set(p.model.toUpperCase(), p);
  return idx;
}

/** 识别文本片段里提到的品类（按 model_prefix.json 的 category_keywords） */
export function detectCategories(prefixRules, text) {
  const out = [];
  for (const [cat, kws] of Object.entries(prefixRules.category_keywords || {})) {
    if (kws.some((k) => has(text, k))) out.push(cat);
  }
  return out;
}

// ---------------- 意图识别（简化版，规则驱动） ----------------

function matchRedline(redlines, text) {
  for (const r of redlines.question_rules) {
    for (const p of r.patterns) {
      if (new RegExp(p, 'i').test(text)) return r;
    }
  }
  return null;
}

function matchMisuse(sub, rawText) {
  const text = String(rawText).replace(/的/g, '');
  const verbHit = sub.misuse.verbs.some((v) => text.includes(v));
  const askCan = /能(不能)?(防|挡|用|当|隔)|可以(防|用|当)|行不行|管用|够不够/.test(text);
  for (const item of sub.misuse.items) {
    const ord = item.ordinary.find((o) => has(text, o));
    if (!ord) continue;
    const whenHit = item.when ? item.when.some((w) => text.includes(w)) : false;
    if (item.when) {
      if (whenHit && (verbHit || askCan)) return { ...item, matched: ord };
    } else if (verbHit) {
      return { ...item, matched: ord };
    }
  }
  return null;
}

/**
 * 意图识别
 * @returns {{intent: string, band: 'RED'|'YELLOW'|'GREEN', rule?: object, models?: string[]}}
 * intent: redline | misuse | model_lookup | equivalence | price | selection | standard | out_of_scope | clarify
 */
export function detectIntent(data, question) {
  const text = String(question || '').trim();
  const { redlines, substitution, hazards, prefix } = data.rules;
  const red = matchRedline(redlines, text);
  if (red) return { intent: 'redline', band: 'RED', rule: red };
  const mis = matchMisuse(substitution, text);
  if (mis) return { intent: 'misuse', band: 'RED', rule: mis };

  const models = extractModels(text);
  if (models.length) return { intent: 'model_lookup', band: 'GREEN', models };
  if (substitution.equivalence.brand_words.some((b) => has(text, b))) return { intent: 'equivalence', band: 'YELLOW' };
  if (/多少钱|价格|报价|几块|便宜|贵不贵|批发价/.test(text)) return { intent: 'price', band: 'YELLOW' };

  const hz = hazards.hazards.filter((h) => h.keywords.some((k) => has(text, k)));
  const cats = detectCategories(prefix, text);
  if (/国标|标准|GB|执行什么/.test(text) && !hz.length) return { intent: 'standard', band: 'GREEN' };
  if (hz.length || cats.length) return { intent: 'selection', band: 'GREEN' };
  if (/灭火器|消防栓|急救箱|监控|电脑|手机/.test(text)) return { intent: 'out_of_scope', band: 'RED' };
  return { intent: 'clarify', band: 'YELLOW' };
}

// ---------------- 场景匹配 ----------------

const bigrams = (s) => {
  const t = String(s || '').replace(/[\s，。、；：:（）()/\-·,.;!?？！]/g, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
};

/** 用二元组重叠给“行业/岗位”打分，返回最相关的岗位 */
export function matchScenarios(data, question, topN = 2) {
  const q = bigrams(question);
  if (!q.size) return [];
  const scored = [];
  for (const ind of data.scenes.industries) {
    const indB = bigrams(ind.industry);
    for (const job of ind.jobs) {
      const jobB = bigrams(job.job);
      const hzB = bigrams(job.hazards.join(''));
      let s = 0;
      for (const g of q) {
        if (jobB.has(g)) s += 3;
        if (indB.has(g)) s += 2;
        if (hzB.has(g)) s += 1;
      }
      if (s >= 4) scored.push({ score: s, industry: ind.industry, job });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}

// ---------------- 选型推荐 ----------------

/** 场景 → 危害 → 品类 → 示例型号 */
export function recommend(data, question, opts = {}) {
  const perCategory = opts.perCategory ?? 3;
  const text = String(question || '');
  const intent = detectIntent(data, text);
  const res = { question: text, ...intent, hazards: [], categories: [], products: [], scenarios: [], standards: [], notices: [] };

  if (intent.intent === 'redline') {
    res.notices.push(intent.rule.message);
    return res;
  }
  if (intent.intent === 'misuse') {
    res.notices.push(`不能用「${intent.rule.matched}」代替${intent.rule.ppe}：${intent.rule.reason}`);
    res.categories = [intent.rule.category];
    const misHz = data.rules.hazards.hazards.filter((h) => h.keywords.some((k) => has(text, k))).map((h) => h.id);
    res.products = pickProducts(data, [intent.rule.category], misHz, perCategory);
    res.standards = standardsFor(data, res.categories, misHz);
    return res;
  }
  if (intent.intent === 'model_lookup') {
    const idx = productIndex(data);
    for (const m of intent.models) {
      const p = idx.get(m);
      if (p) res.products.push(p);
      else res.notices.push(`型号 ${m} 不在本开源示例产品表中，无法确认参数，请联系成楷客服核实。`);
    }
    if (!res.products.length) res.band = 'YELLOW';
    res.categories = uniq(res.products.map((p) => p.category));
    // 型号查询：只列该型号自身引用的标准，不按品类整类列出
    const codes = new Set(res.products.flatMap((p) => String(p.standard || '').split(/[；;]/).map((c) => c.trim())));
    res.standards = data.standards.filter((s) => codes.has(s.code));
    return res;
  }
  if (intent.intent === 'price') {
    res.notices.push('本工具不提供价格，价格和库存以成楷官方店铺页面为准。');
  }
  if (intent.intent === 'equivalence') {
    res.notices.push(data.rules.substitution.equivalence.principle);
  }
  if (intent.intent === 'out_of_scope') {
    res.notices.push('这个问题不在个体防护用品（PPE）范围内，本工具只回答劳保防护选型。');
    return res;
  }

  const directCats = detectCategories(data.rules.prefix, text);
  // 问价格时只看直接提到的品类
  const hz = intent.intent === 'price' && directCats.length ? [] : data.rules.hazards.hazards.filter((h) => h.keywords.some((k) => has(text, k)));
  res.hazards = hz.map((h) => ({ id: h.id, name: h.name }));
  let cats = uniq([...hz.flatMap((h) => h.categories), ...directCats]);
  // 问“面罩”且有焊接危害时，归到焊接防护
  if (hz.some((h) => h.id === 'welding_arc')) cats = cats.filter((c) => c !== '面部防护' || !has(text, '焊'));
  res.categories = cats;
  const hzIds = uniq(hz.flatMap((h) => [h.id, ...(h.related || [])]));
  res.products = pickProducts(data, cats, hzIds, perCategory);
  res.scenarios = matchScenarios(data, text).map((s) => ({ industry: s.industry, job: s.job.job, hazards: s.job.hazards, ppe: s.job.ppe, mistakes: s.job.mistakes }));
  // 问“××执行什么标准”时，按问到的产品名词收窄品类，只给对口标准
  const askStd = /国标|标准|GB|执行什么/i.test(text);
  const nounCats = askStd ? stdNounCategories(text) : [];
  const stdCats = nounCats.length ? nounCats : cats;
  res.standards = standardsFor(data, stdCats, hzIds);
  for (const c of stdCats) {
    if (res.standards.some((s) => s.category === c)) continue;
    const scoped = data.standards.filter((s) => s.category === c && (s.for_hazards || s.only_for_hazard));
    if (!scoped.length) continue;
    if (askStd && hzIds.length) res.notices.push(`${c}：本对照表没有与该工况直接对口的国标，请按相关国家标准选型，以产品检测报告为准。`);
    else res.notices.push(`${c}的国标按危害区分：${scoped.map((s) => `${s.code}（${s.name}）`).join('；')}。请说明具体防护什么（如切割、化学品、高温、低温、焊接），以产品检测报告为准。`);
  }

  if (hz.some((h) => h.id === 'fall')) res.notices.push('高处作业的安全带及挂点系统必须按 GB 6095 和现场评估配置，本示例产品表暂未收录坠落防护型号，请联系成楷客服。');
  if (hz.some((h) => h.resp_type === 'gas')) res.notices.push('防毒必须先确认化学品名称和浓度，按气体种类配对应滤毒盒；缺氧或受限空间不能用过滤式面具。');
  const missing = cats.filter((c) => !res.products.some((p) => p.category === c));
  if (missing.length) res.notices.push(`以下品类在本示例产品表中暂无与该工况对口的型号：${missing.join('、')}（防护要求见上方场景建议）。`);
  if (intent.intent === 'clarify' || (!hz.length && intent.intent !== 'price')) {
    res.band = 'YELLOW';
    res.notices.push('请补充工况：什么行业/岗位、接触什么（粉尘、气体、飞溅、噪声、高温、锐边…）、作业时长和环境。');
  } else if (!res.products.length) {
    res.band = 'YELLOW';
  }
  return res;
}

function pickProducts(data, cats, hzIds, perCategory) {
  const gas = hzIds.includes('organic_vapor');
  const out = [];
  for (const cat of cats) {
    let list = data.products.filter((p) => p.category === cat);
    if (cat === '呼吸防护' && hzIds.length) {
      // 有毒气体 → 只推防毒类；仅颗粒物 → 只推防尘类
      list = list.filter((p) => (gas ? p.hazards.includes('organic_vapor') : !p.hazards.includes('organic_vapor') || p.hazards.includes('dust')));
    }
    const scored = list
      .map((p) => {
        let s = hzIds.length ? p.hazards.filter((h) => hzIds.includes(h)).length : 1;
        // 只有颗粒物危害时，纯防尘产品排在防毒产品前
        if (s > 0 && cat === '呼吸防护' && !gas && p.hazards.includes('organic_vapor')) s -= 0.5;
        return { p, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    // 同品类内按型号前缀轮流挑选，让结果覆盖不同类型（如焊接：面罩 + 皮具）
    const groups = new Map();
    for (const x of scored) {
      const k = prefixOf(x.p.model);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x.p);
    }
    const picked = [];
    while (picked.length < perCategory && [...groups.values()].some((g) => g.length)) {
      for (const g of groups.values()) if (g.length && picked.length < perCategory) picked.push(g.shift());
    }
    for (const p of picked) if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** 标准按品类 + 危害精确匹配：带 for_hazards / only_for_hazard 的标准只在命中对应危害时列出 */
function standardsFor(data, cats, hzIds = []) {
  return data.standards.filter((s) => {
    if (!cats.includes(s.category)) return false;
    if (s.only_for_hazard && !hzIds.includes(s.only_for_hazard)) return false;
    if (s.for_hazards && !s.for_hazards.some((h) => hzIds.includes(h))) return false;
    return true;
  });
}

// 问标准时的产品名词 → 品类（焊接语境下的面罩/眼镜归焊接防护）
const STD_NOUNS = [
  [/手套/, '手部防护'],
  [/口罩|面具|呼吸器|滤盒|滤棉/, '呼吸防护'],
  [/安全帽|头盔/, '头部防护'],
  [/安全鞋|劳保鞋|绝缘鞋|雨靴/, '足部防护'],
  [/耳塞|耳罩|护听器/, '听力防护'],
  [/安全带|安全绳/, '坠落防护'],
  [/防护服|工作服|反光衣|反光背心|警示服/, '身体防护'],
  [/护目镜|防护眼镜|眼罩/, '眼部防护'],
  [/面罩|面屏/, '面部防护'],
];
function stdNounCategories(text) {
  const out = [];
  for (const [re, cat] of STD_NOUNS) if (re.test(text)) out.push(cat);
  if (/焊/.test(text)) return uniq(out.map((c) => (c === '面部防护' || c === '眼部防护' ? '焊接防护' : c)));
  return uniq(out);
}

// ---------------- 回答校验（型号硬校验 + 红线） ----------------

/**
 * 校验一段回答：
 *  - 回答中出现的每个 CK 型号必须在产品表里（防止大模型编型号）
 *  - 型号前缀必须与产品品类自洽，且与其前文描述的品类自洽（防止“防毒面具 CKB-702”）
 *  - 不得含广告法绝对化用语、价格、认证编号、贬损其他品牌
 * @returns {{ok: boolean, models: string[], errors: Array<{code: string, model?: string, message: string}>}}
 */
export function validateAnswer(data, answer) {
  const text = String(answer || '');
  const idx = productIndex(data);
  const prefixRules = data.rules.prefix;
  const errors = [];
  const models = extractModels(text);
  for (const m of models) {
    const pre = prefixOf(m);
    if (!prefixRules.prefixes[pre]) {
      errors.push({ code: 'UNKNOWN_PREFIX', model: m, message: `型号前缀 ${pre} 不在成楷命名规则内` });
      continue;
    }
    const p = idx.get(m);
    if (!p) {
      errors.push({ code: 'UNKNOWN_MODEL', model: m, message: `型号 ${m} 不在产品表中（可能是编造的）` });
    } else if (!prefixAllows(prefixRules, m, p.category)) {
      errors.push({ code: 'PREFIX_CATEGORY_MISMATCH', model: m, message: `${m} 的前缀与其品类「${p.category}」不符` });
    }
    // 前文语境：同一分句里型号前面的描述
    const re = new RegExp(`([^。；;\\n，,]{0,16})${m.replace(/[-]/g, '\\-')}`, 'gi');
    for (const mm of text.matchAll(re)) {
      const ctxCats = detectCategories(prefixRules, mm[1]);
      if (ctxCats.length && !ctxCats.some((c) => prefixRules.prefixes[pre].allowed_categories.includes(c))) {
        errors.push({ code: 'PREFIX_CONTEXT_MISMATCH', model: m, message: `「${mm[1].trim()}」描述的是${ctxCats.join('/')}，但 ${pre} 前缀属于${prefixRules.prefixes[pre].name}` });
        break;
      }
    }
  }
  for (const r of data.rules.redlines.answer_rules) {
    const hit = new RegExp(r.pattern, 'i').exec(text);
    if (hit) errors.push({ code: r.id, message: `${r.message}：「${hit[0]}」` });
  }
  return { ok: errors.length === 0, models, errors };
}

/** 把校验不过的型号替换成占位，避免错误型号流到用户面前 */
export function sanitizeAnswer(answer, report) {
  let out = String(answer || '');
  const bad = uniq(report.errors.filter((e) => e.model).map((e) => e.model));
  for (const m of bad) out = out.replace(new RegExp(m.replace(/-/g, '\\-'), 'gi'), '【型号待核】');
  return out;
}

// ---------------- 离线回答渲染 ----------------

export function renderAnswer(res) {
  const lines = [];
  if (res.band === 'RED') lines.push('⚠ 安全提示');
  for (const n of res.notices) lines.push(`- ${n}`);
  if (res.scenarios.length) {
    const s = res.scenarios[0];
    lines.push(`\n参考场景：${s.industry} / ${s.job}`);
    for (const p of s.ppe.slice(0, 8)) lines.push(`- [${p.part}] ${p.need}${p.standard ? `（${p.standard}）` : ''}`);
  }
  if (res.products.length) {
    lines.push('\n成楷示例型号：');
    for (const p of res.products) {
      lines.push(`- ${p.model} ${p.name}（${p.category}）：${p.key_params.join('；')}${p.links?.tmall ? ` ${p.links.tmall}` : ''}`);
    }
  }
  if (res.standards.length) lines.push(`\n相关国标：${res.standards.map((s) => `${s.code} ${s.name}`).join('；')}`);
  lines.push('\n产品数据仅供参考，以实物和检测报告为准。');
  return lines.join('\n');
}

// ---------------- 大模型提示词 ----------------

export function buildMessages(data, question, rec) {
  const candidates = rec.products.map((p) => ({ model: p.model, name: p.name, category: p.category, scenes: p.scenes, key_params: p.key_params, standard: p.standard }));
  const system = [
    '你是成楷（劳保防护用品品牌）的 PPE 选型顾问，回答要专业、口语、简洁（200 字以内）。',
    '规则：',
    '1. 只能推荐“候选型号”里的成楷型号，原样写型号，不得编造或改写型号；候选为空就只讲防护类型，不提型号。',
    '2. 不报价格、库存、发货时效，不编造检测报告或证书编号。',
    '3. 不用“最好/第一/100%/绝对/万能”等绝对化用语；不评价、不贬损其他品牌。',
    '4. 缺氧、受限空间、带电作业、高处坠落等高风险情况，必须提醒找专业人员现场评估。',
    '5. 引用国标只用参考资料里给出的编号；结尾提醒“以实物和检测报告为准”。',
  ].join('\n');
  const ctx = {
    识别结果: { 意图: rec.intent, 危害: rec.hazards.map((h) => h.name), 品类: rec.categories },
    提示: rec.notices,
    参考场景: rec.scenarios.map((s) => ({ 行业: s.industry, 岗位: s.job, 建议防护: s.ppe.map((p) => `[${p.part}] ${p.need}`), 常见错误: s.mistakes })),
    候选型号: candidates,
    参考国标: rec.standards.map((s) => `${s.code} ${s.name}`),
  };
  return [
    { role: 'system', content: system },
    { role: 'user', content: `客户问题：${question}\n\n参考资料（JSON）：\n${JSON.stringify(ctx, null, 1)}` },
  ];
}
