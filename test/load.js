/* Node 載入器：把瀏覽器用的 script 塞進 global 再匯出 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FILES = ['cards.js', 'engine.js', 'generals.js', 'generals-extra.js', 'generals-packs.js', 'skills-windfire.js', 'ai.js', 'setup.js'];

function load() {
  for (const f of FILES) {
    const file = path.join(__dirname, '..', 'js', f);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: f });
  }
  return globalThis;
}

module.exports = { load, root: load() };
