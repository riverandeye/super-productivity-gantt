// Build: copy src/ to dist/, inline lib.js and the i18n strings into index.html,
// then zip dist/ flat into release/. No dependencies; uses the system `zip` command.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
const langs = manifest.i18n?.languages ?? ['en'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'i18n'), { recursive: true });

// Translations: the host reads i18n/<lang>.json (for plugin.js); the iframe gets
// the same strings inlined so it can translate synchronously.
const strings = {};
const enKeys = Object.keys(JSON.parse(readFileSync(join(src, 'i18n', 'en.json'), 'utf8')));
for (const lang of langs) {
  const file = join(src, 'i18n', `${lang}.json`);
  strings[lang] = JSON.parse(readFileSync(file, 'utf8'));
  const missing = enKeys.filter((k) => !(k in strings[lang]));
  if (missing.length) throw new Error(`i18n/${lang}.json is missing: ${missing.join(', ')}`);
  copyFileSync(file, join(dist, 'i18n', `${lang}.json`));
}

const inline = (html, marker, value) => {
  if (!html.includes(marker)) throw new Error(`index.html is missing "${marker}"`);
  return html.replace(marker, () => value);
};
const lib = readFileSync(join(src, 'lib.js'), 'utf8');
const i18nJson = JSON.stringify(strings).replace(/</g, '\\u003c');
if (lib.includes('</script')) throw new Error('lib.js must not contain "</script"');
let html = readFileSync(join(src, 'index.html'), 'utf8');
html = inline(html, '<!-- @inline lib.js -->', `<script>\n${lib}</script>`);
html = inline(html, '/* @inline i18n */ { en: {} }', i18nJson);
writeFileSync(join(dist, 'index.html'), html);
for (const f of ['manifest.json', 'plugin.js', 'icon.svg']) copyFileSync(join(src, f), join(dist, f));

mkdirSync(join(root, 'release'), { recursive: true });
const zipPath = join(root, 'release', `${manifest.id}-${manifest.version}.zip`);
rmSync(zipPath, { force: true });
const files = ['manifest.json', 'plugin.js', 'index.html', 'icon.svg', ...langs.map((l) => `i18n/${l}.json`)];
execFileSync('zip', ['-q', '-X', zipPath, ...files], { cwd: dist });
console.log(`Built ${zipPath}`);
