const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|json)$/.test(file)) {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      if (file.endsWith('.js')) new vm.Script(text, { filename: file });
      else JSON.parse(text);
      count++;
    }
  }
}
walk(path.join(root, 'miniprogram'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
for (const route of app.pages) for (const ext of ['js', 'json', 'wxml', 'wxss']) {
  if (!fs.existsSync(path.join(root, 'miniprogram', `${route}.${ext}`))) throw new Error(`Missing ${route}.${ext}`);
}
console.log(`PASS: ${count} JS/JSON files parsed; ${app.pages.length} complete native page routes`);
