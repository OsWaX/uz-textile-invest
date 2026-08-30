'use strict';
/** Проверка синтаксиса клиентских ES-модулей (запуск: node --experimental-vm-modules scripts/check-frontend.js). */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'public', 'js');
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})(root);

let failed = 0;
for (const file of files) {
  try {
    // eslint-disable-next-line no-new
    new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file });
    console.log(`  ok   ${path.relative(root, file)}`);
  } catch (error) {
    failed += 1;
    console.error(`  ОШИБКА ${path.relative(root, file)}: ${error.message}`);
  }
}
if (failed) process.exit(1);
console.log(`\nПроверено модулей: ${files.length}`);
