import fs from 'fs';
let s = fs.readFileSync('dist/index.html', 'utf8');
const m = s.match(/<script type="module" crossorigin>[\s\S]*?<\/script>/);
const body = s.replace(m[0], '') + '\n' + m[0].replace(' crossorigin', '') + '\n';
// 1) fragment for the claude.ai artifact (the artifact wraps it in its own skeleton)
fs.writeFileSync('dist/ballistic.html', body);
// 2) a complete document for GitHub Pages
const title = body.match(/<title>.*?<\/title>/)[0];
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Rolling toy balls with guns. Solo against bots, or 1v1 and co-op with a friend over an invite link.">
${title}
</head>
<body>
${body.replace(title, '')}
</body>
</html>
`;
fs.mkdirSync('site', { recursive: true });
fs.writeFileSync('site/index.html', page);
fs.writeFileSync('site/.nojekyll', '');
console.log('artifact', body.length, 'site', page.length);
