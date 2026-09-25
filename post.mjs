import fs from 'fs';
let s = fs.readFileSync('dist/index.html', 'utf8');
const m = s.match(/<script type="module" crossorigin>[\s\S]*?<\/script>/);
s = s.replace(m[0], '') + '\n' + m[0].replace(' crossorigin', '') + '\n';
fs.writeFileSync('dist/ballistic.html', s);
console.log('title at', s.indexOf('<title>'), 'size', s.length);
