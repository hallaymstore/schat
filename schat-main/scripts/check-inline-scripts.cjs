const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('public/group.html', 'utf8');
const expression = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;

while ((match = expression.exec(html))) {
  if (/\bsrc\s*=/.test(match[1])) continue;
  const type = (match[1].match(/\btype\s*=\s*["']([^"']+)/i) || [])[1] || '';
  if (type && !/javascript|ecmascript/i.test(type)) continue;
  count += 1;
  new vm.Script(match[2], { filename: `group-inline-${count}.js` });
}

console.log(`inline scripts parsed: ${count}`);
