import { readFile } from 'node:fs/promises';
const load = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
export async function renderStandalone({ profiles = null } = {}) {
  const [html, css, engine, fixtures, app] = await Promise.all(['public/index.html','public/styles.css','src/engine.mjs','src/fixtures.mjs','public/app.js'].map(load));
  const serialized = profiles ? JSON.stringify(profiles).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) : 'null';
  const config = "window.OMNI_INLINE = true;\n" + (profiles ? "window.OMNI_INITIAL_VIEW = 'public-profiles';\nwindow.OMNI_PUBLIC_PROFILES = " + serialized + ";\n" : '');
  const code = config + fixtures.replaceAll('export const ', 'const ') + '\n' + engine.replaceAll('export const ', 'const ').replaceAll('export function ', 'function ') + '\n' + app.replace(/^import .+;\s*$/gm, '');
  return html.replace('<link rel="stylesheet" href="/styles.css">', () => '<style>' + css + '</style>')
    .replace('<link rel="icon" href="/favicon.svg" type="image/svg+xml">', '')
    .replace('<script type="module" src="/app.js"></script>', () => '<script type="module">' + code.replace(/<\/script/gi, '<\\/script') + '</script>');
}
