import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { extractModels, detectIntent, recommend, validateAnswer, sanitizeAnswer, prefixAllows, buildMessages } from '../src/core.js';

const data = loadData();

test('extractModels：抽型号、大写、去重', () => {
  assert.deepEqual(extractModels('推荐 ckh-0303 和 CKH-0303，还有CKL-3116。'), ['CKH-0303', 'CKL-3116']);
  assert.deepEqual(extractModels('没有型号'), []);
});

test('产品表：每个型号前缀与品类自洽、都有店铺链接、无价格字段', () => {
  for (const p of data.products) {
    assert.ok(prefixAllows(data.rules.prefix, p.model, p.category), `${p.model} 前缀与品类 ${p.category} 不符`);
    assert.match(p.links.tmall, /^https:\/\/detail\.tmall\.com\/item\.htm\?id=\d+$/, `${p.model} 缺天猫链接`);
    const keys = Object.keys(p).join(',');
    assert.doesNotMatch(keys, /price|cost|stock|批发|成本|进价|库存/i);
  }
  assert.ok(data.products.length >= 20 && data.products.length <= 30);
});

test('产品表引用的国标都在对照表中', () => {
  const codes = new Set(data.standards.map((s) => s.code));
  for (const p of data.products) {
    if (p.standard === '按相关国家标准') continue;
    assert.ok(codes.has(p.standard), `${p.model} 引用的 ${p.standard} 不在 standards.json`);
  }
});

test('红线：受限空间 / 安全带承重 / 带电作业 判 RED', () => {
  assert.equal(detectIntent(data, '下化粪池清淤戴什么口罩').band, 'RED');
  assert.equal(detectIntent(data, '安全带能承重多少斤').intent, 'redline');
  assert.equal(detectIntent(data, '10kV带电作业戴什么手套').intent, 'redline');
});

test('替代误用：普通品代替专业防护 判 RED', () => {
  for (const q of ['普通运动鞋能当安全鞋用吗', '普通棉口罩能防有机溶剂毒气吗', '太阳镜能当打磨护目镜用吗', '用普通尼龙绳代替安全带行不行', '一次性手套能防切割吗', '防雾霾的口罩能防有机溶剂气体吗']) {
    assert.equal(detectIntent(data, q).band, 'RED', q);
  }
  // 正常提问不能误判
  assert.notEqual(detectIntent(data, '电焊面罩里面还要不要加护目镜').band, 'RED');
  assert.notEqual(detectIntent(data, '喷漆车间戴什么防毒面具').band, 'RED');
});

test('意图：型号查询 / 价格 / 超范围 / 竞品对照', () => {
  assert.equal(detectIntent(data, 'CKL-3116 是什么').intent, 'model_lookup');
  assert.equal(detectIntent(data, '安全帽多少钱').intent, 'price');
  assert.equal(detectIntent(data, '你们卖灭火器吗').intent, 'out_of_scope');
  assert.equal(detectIntent(data, '3M 6200 有没有替代').intent, 'equivalence');
});

test('选型：喷漆 → 只推防毒类呼吸产品，不推纯防尘', () => {
  const r = recommend(data, '喷漆车间工人戴什么防护');
  const resp = r.products.filter((p) => p.category === '呼吸防护');
  assert.ok(resp.length > 0);
  for (const p of resp) assert.ok(p.hazards.includes('organic_vapor'), p.model);
  assert.ok(r.notices.some((n) => n.includes('化学品')));
});

test('选型：打磨粉尘 → 防尘类排前', () => {
  const r = recommend(data, '打磨不锈钢粉尘大');
  const first = r.products.find((p) => p.category === '呼吸防护');
  assert.ok(!first.hazards.includes('organic_vapor'), first.model);
  assert.ok(r.products.some((p) => p.category === '眼部防护'));
});

test('选型：电焊 → 焊接面罩 + 焊工皮具，型号前缀正确', () => {
  const r = recommend(data, '电焊工全套劳保怎么配');
  const models = r.products.map((p) => p.model);
  assert.ok(models.some((m) => m.startsWith('CKL-')));
  assert.ok(models.some((m) => m.startsWith('CKB-')));
  assert.ok(r.scenarios.length > 0);
});

test('选型：信息不足 → YELLOW 追问', () => {
  const r = recommend(data, '我要个防护面罩');
  assert.equal(r.band, 'YELLOW');
  assert.ok(r.notices.some((n) => n.includes('请补充工况')));
});

test('型号硬校验：编造型号 / 前缀与语境不符 被拦', () => {
  const v1 = validateAnswer(data, '喷漆推荐 CKH-0303 防毒半面具，再配 CKH-9999。');
  assert.equal(v1.ok, false);
  assert.ok(v1.errors.some((e) => e.code === 'UNKNOWN_MODEL' && e.model === 'CKH-9999'));

  // 0905 真实事故：把电焊面罩型号当防毒面具推荐
  const v2 = validateAnswer(data, '喷漆车间建议戴防毒面具 CKB-702');
  assert.ok(v2.errors.some((e) => e.code === 'PREFIX_CONTEXT_MISMATCH'));

  const v3 = validateAnswer(data, '焊接请用电焊面罩 CKL-3116，手部用 CKB-2112 牛皮手套。');
  assert.equal(v3.ok, true, JSON.stringify(v3.errors));

  const v4 = validateAnswer(data, '推荐 CKZ-100');
  assert.ok(v4.errors.some((e) => e.code === 'UNKNOWN_PREFIX'));
});

test('回答红线：价格 / 绝对化用语 / 贬损品牌', () => {
  assert.ok(validateAnswer(data, 'CKH-0303 只要 39元').errors.some((e) => e.code === 'A-PRICE'));
  assert.ok(validateAnswer(data, '这是最好的面具').errors.some((e) => e.code === 'A-AD-LAW'));
  assert.ok(validateAnswer(data, '3M 的不如我们').errors.some((e) => e.code === 'A-DISPARAGE'));
  assert.equal(validateAnswer(data, '防毒要配对应的过滤元件，以检测报告为准。').ok, true);
});

test('sanitizeAnswer：错误型号被替换', () => {
  const ans = '推荐 CKH-9999 和 CKH-0303';
  const out = sanitizeAnswer(ans, validateAnswer(data, ans));
  assert.ok(!out.includes('CKH-9999'));
  assert.ok(out.includes('CKH-0303'));
});

test('buildMessages：候选型号只来自推荐结果', () => {
  const rec = recommend(data, '喷漆车间工人戴什么防护');
  const msgs = buildMessages(data, '喷漆车间工人戴什么防护', rec);
  assert.equal(msgs[0].role, 'system');
  for (const m of extractModels(msgs[1].content)) assert.ok(rec.products.some((p) => p.model === m), m);
});

test('红线：安全绳承重 / 普通绳绑腰登高 / 绳带代替安全带 判 RED', () => {
  for (const q of ['安全绳能拉几公斤', '用普通尼龙绳绑腰上登高可以吗', '安全带承重多少公斤', '拿布带代替安全带行不行', '用绳子当坠落防护可以吗']) {
    const r = detectIntent(data, q);
    assert.equal(r.band, 'RED', q);
    assert.equal(r.intent, 'redline', q);
  }
});

test('国标检索精筛：手套按危害给对口标准，不整类列出', () => {
  const codes = (q) => recommend(data, q).standards.map((s) => s.code);
  assert.deepEqual(codes('焊工手套执行什么标准'), ['GB 45188-2024']);
  assert.deepEqual(codes('耐热手套执行什么国标'), ['GB 38306-2025']);
  assert.deepEqual(codes('防割手套执行什么标准'), ['GB 24541-2022']);
  assert.deepEqual(codes('冷库防寒手套执行什么标准'), ['GB 38304-2025']);
  assert.deepEqual(codes('耐酸碱化学手套执行什么标准'), ['GB 28881-2023']);
  // 没说危害：不列手部标准，提示按危害区分
  const r = recommend(data, '手套执行什么标准');
  assert.equal(r.standards.filter((s) => s.category === '手部防护').length, 0);
  assert.ok(r.notices.some((n) => n.includes('按危害区分')));
  // 型号查询只列该型号自身标准
  assert.deepEqual(recommend(data, 'CKS-CUTRE-PU 执行什么标准').standards.map((s) => s.code), ['GB 24541-2022']);
});
