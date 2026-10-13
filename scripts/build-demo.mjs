#!/usr/bin/env node
// 生成 demo/ 所需的两个静态文件，让 demo/index.html 双击即可离线打开（无需后端、无需联网）：
//   demo/data.js  ← products / standards / scenarios / rules 的 JSON
//   demo/core.js  ← engine/src/core.js 去掉 ESM export 后的浏览器版
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadData, REPO_ROOT } from '../engine/src/data.js';

const data = loadData();
delete data.qa; // demo 不需要问答全集
writeFileSync(join(REPO_ROOT, 'demo/data.js'), `// 自动生成，请勿手改：node scripts/build-demo.mjs\nwindow.CKPPE_DATA = ${JSON.stringify(data)};\n`);

const src = readFileSync(join(REPO_ROOT, 'engine/src/core.js'), 'utf8');
const names = [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
const body = src.replace(/^export /gm, '');
writeFileSync(
  join(REPO_ROOT, 'demo/core.js'),
  `// 自动生成，请勿手改：node scripts/build-demo.mjs（源：engine/src/core.js）\n(function () {\n${body}\nwindow.CKPPE = { ${names.join(', ')} };\n})();\n`
);
console.log('demo/data.js, demo/core.js 已生成；导出', names.length, '个函数');
