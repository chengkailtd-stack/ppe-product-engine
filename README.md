# 成楷 PPE 产品智能引擎

说出你的工况，给出**防护建议、相关国标和成楷示例型号**。

这是成楷（劳保个体防护用品品牌）把内部 PPE 选型经验整理成的开源版本，包括：行业场景知识、国标对照表、型号命名与红线规则、一个无第三方依赖的 Node 引擎，以及一个打开就能用的网页 Demo。

> 产品数据仅供参考，以实物和检测报告为准。详见 [DATA_NOTICE.md](DATA_NOTICE.md)。

## 能做什么

- **选型推荐**：工况 → 危害 → 防护品类 → 成楷示例型号（附天猫店铺链接）
- **型号硬校验**：回答里出现的每个 `CKx-xxxx` 型号必须真实存在于产品表，且型号前缀与品类自洽（例如呼吸类必须是 `CKH-`），防止大模型编型号、张冠李戴
- **安全红线**：受限空间/缺氧、带电作业、坠落承重、用普通物品代替防护用品（如“运动鞋当安全鞋”）等，一律给出安全提示，不硬推产品
- **合规**：回答不报价格、不用广告法绝对化用语、不编造报告编号、不贬损其他品牌
- **接大模型**：可接任意 OpenAI 兼容接口（通义千问、DeepSeek 等），Key 由使用者自备，仓库不内置、不保存；大模型的回答同样要过型号硬校验

## 范围说明

首版只包含：引擎代码、规则（型号前缀/红线/替代/危害关键词）、已审场景样例、国标对照表和 30 个示例型号。

不包含：
- FastGPT 等工作流编排、提示词工程原稿；
- 任何模型权重或微调数据；
- 客户、供应商、价格、成本、库存、客服对话原话等经营数据；
- 国家标准正文——`standards/` 只引用标准编号与名称，选型要点为自行概括，标准原文请到[全国标准信息公共服务平台](https://std.samr.gov.cn)或国家标准全文公开系统查阅。

## 数据来源与授权

- **场景知识与规则**（`scenarios/`、`rules/`）：由成楷整理（大模型蒸馏初稿 + 成楷负责人审阅）。
- **国标对照**（`standards/`）：编号、名称、实施状态于 2026-10-14 在全国标准信息公共服务平台逐条核对；标准本身的著作权归原发布机构，本仓库不复制标准正文。
- **示例型号与链接**（`products/`）：均为成楷自有在售商品，链接指向成楷官方店铺。
- **许可适用范围**：Apache-2.0 适用于本仓库的代码和上述整理数据；不授予“成楷”名称与商标的使用权（见 [NOTICE](NOTICE)），也不延及国家标准文本和第三方店铺页面内容。

## 目录

```
rules/        型号前缀↔品类、红线、替代规则、危害关键词
standards/    品类 → 危害 → 国标编号/名称/选型要点
scenarios/    场景卡（26 个行业、156 个岗位）和问答（300 + 156 条），已审样例
products/     30 个成楷示例型号（JSON / CSV），含店铺链接，不含价格
engine/       Node 引擎（ESM，零依赖）+ 测试
eval/         金标准题集 + 打分脚本
demo/         纯前端单页 Demo（双击 index.html 即可）
scripts/      生成 Demo 数据
```

## 快速开始

需要 Node.js 18 及以上。

```bash
# 离线规则回答（不需要任何 Key）
node engine/bin/ckppe.js "喷漆车间工人戴什么防护"

# 接大模型（任选其一）
export DASHSCOPE_API_KEY=你的通义千问Key   # 默认 provider=qwen
node engine/bin/ckppe.js "电焊工全套劳保怎么配" --llm

export DEEPSEEK_API_KEY=你的DeepSeekKey
node engine/bin/ckppe.js "电焊工全套劳保怎么配" --llm --provider deepseek

# 其他 OpenAI 兼容接口
export CKPPE_BASE_URL=https://your-endpoint/v1 CKPPE_MODEL=your-model CKPPE_API_KEY=...

# 测试与评测（均在仓库根目录执行）
npm --prefix engine test
node eval/run.mjs            # 离线评测
node eval/run.mjs --llm      # 评测大模型回答
```

代码里使用：

```js
import { createEngine } from './engine/src/index.js';
const engine = createEngine();
const r = await engine.ask('打磨不锈钢粉尘大');          // 离线
console.log(r.answer);
const v = engine.validate('喷漆推荐防毒面具 CKB-702');   // 型号硬校验
console.log(v.errors);   // PREFIX_CONTEXT_MISMATCH / UNKNOWN_MODEL ...
```

本仓库**不内置、不保存任何 API Key**，Key 只从你的环境变量或参数读取。

大模型回答必须通过校验（型号在产品表且属于本次候选、型号与就近描述品类一致、无价格/绝对化用语/编造报告编号等）才会展示；不通过时改为规则引擎的确定性回答，被拒原文不展示，只有 `--debug`（代码里 `ask(q, { debug: true })`）才返回原文和校验细节。

## 网页 Demo

直接用浏览器打开 `demo/index.html`。改了 `products/`、`scenarios/` 或 `engine/src/core.js` 之后，运行 `node scripts/build-demo.mjs` 重新生成 Demo 数据。

## 型号命名规则

| 前缀 | 品类 |
|---|---|
| CKH | 呼吸防护 |
| CKY | 眼部防护 |
| CKL | 面部防护（面屏、电焊面罩） |
| CKB | 身体防护（含焊工皮具、雨衣、防护服、安全带） |
| CKS | 手部防护 |
| CKT | 头部防护 |
| CKE | 听力防护 |
| CKF | 足部防护 |

## 参与贡献

欢迎提交 Issue / PR：补充场景、纠正错误、改进意图识别。涉及安全判断的修改请附依据（标准条款或权威资料）。场景知识以成楷专业人员审核结论为准。

## 许可

代码和数据以 [Apache-2.0](LICENSE) 发布，版权所有 © 2026 北京成楷恒业科技有限公司。“成楷”名称与商标不在许可范围内，见 [NOTICE](NOTICE)。

---

## English

**Chengkai PPE Engine** recommends personal protective equipment from a plain-language description of the work environment: hazards → PPE categories → relevant Chinese national standards (GB) → example Chengkai product models with store links.

- Zero-dependency Node.js (ESM) engine with rule-based intent detection, safety red lines, and a **hard model-number check** (every `CKx-` model in an answer must exist in the product table and match its category prefix).
- Bring your own key for any OpenAI-compatible LLM (e.g. Qwen, DeepSeek); LLM answers are validated before being shown.
- Offline single-page demo in `demo/`.
- Product data is for reference only; actual products and test reports prevail. No prices included.

License: Apache-2.0, © 2026 Beijing Chengkai Hengye Technology Co., Ltd.
