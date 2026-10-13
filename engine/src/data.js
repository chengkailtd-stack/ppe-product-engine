// Node 端数据加载：读取仓库根目录下 rules/ standards/ scenarios/ products/
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const readJson = (root, p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const readJsonl = (root, p) =>
  readFileSync(join(root, p), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

/** 加载全部数据；root 默认为仓库根目录 */
export function loadData(root = REPO_ROOT) {
  return {
    products: readJson(root, 'products/products.json').products,
    standards: readJson(root, 'standards/standards.json').standards,
    scenes: readJson(root, 'scenarios/scene_cards.json'),
    qa: readJsonl(root, 'scenarios/qa.jsonl'),
    rules: {
      prefix: readJson(root, 'rules/model_prefix.json'),
      redlines: readJson(root, 'rules/redlines.json'),
      substitution: readJson(root, 'rules/substitution.json'),
      hazards: readJson(root, 'rules/hazards.json'),
    },
  };
}
