import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
const root = process.cwd();
for (const target of ['dist/client', 'dist/server', 'dist/.openai']) {
  const absolute = path.resolve(root, target);
  if (!absolute.startsWith(root + path.sep)) throw new Error('Invalid build path');
  fs.rmSync(absolute, { recursive: true, force: true }); fs.mkdirSync(absolute, { recursive: true });
}
for (const entry of fs.readdirSync('dist', { withFileTypes: true })) if (entry.isFile()) fs.copyFileSync(`dist/${entry.name}`, `dist/client/${entry.name}`);
const mime = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json' };
const assets = Object.fromEntries(fs.readdirSync('dist/client').map(name => ['/' + name, { type: mime[path.extname(name)] || 'text/plain', text: fs.readFileSync('dist/client/' + name, 'utf8') }]));
await build({ entryPoints: ['server/worker.js'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: false, define: { __EMBEDDED_ASSETS__: JSON.stringify(assets) } });
fs.copyFileSync('.openai/hosting.json', 'dist/.openai/hosting.json');
fs.cpSync('drizzle', 'dist/.openai/drizzle', { recursive: true });
console.log('Built frontend, session Worker, and database migrations.');
