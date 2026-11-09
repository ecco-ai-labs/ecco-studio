#!/usr/bin/env node
// Builds from design-system/size-roster.json, the single place for sizes, heights and theme colors:
//   design-system/sizes.css            sizes and heights
//   theme.js (PALETTE and PRESETS)     theme colors
//   glass-themes.css (first lines)     Ocean and Dark Sky backdrops
//   node scripts/size_roster.mjs          regenerate
//   node scripts/size_roster.mjs --check  fail when a generated file is stale or the roster is invalid
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sizes = require(path.join(root, 'design-system/sizes.js'));
const roster = JSON.parse(readFileSync(path.join(root, 'design-system/size-roster.json'), 'utf8'));
const contract = JSON.parse(readFileSync(path.join(root, 'design-system/ui-contract.json'), 'utf8'));

const components = new Set(contract.components.map(c => c.id));
const problems = [];
for (const entry of sizes.entries(roster)) {
  const component = entry.contractComponent || roster.types.find(t => t.id === entry.of)?.contractComponent;
  if (!components.has(component)) problems.push(`${entry.id}: contractComponent "${component}" is not registered in ui-contract.json`);
}
let css = '';
try { css = sizes.compile(roster); } catch (error) { problems.push(error.message); }
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

// Theme colors: theme.js keeps its PALETTE and PRESETS lines, generated from roster.colors.
const COLOR=/^(#[0-9a-fA-F]{3,8}|rgba?\([0-9., %]+\))$/;
function themeFiles() {
  const colors = roster.colors;
  if (!colors?.roles || !colors?.themes?.default) { problems.push('size-roster.json needs a colors section with roles and a default theme.'); return []; }
  for (const [role, info] of Object.entries(colors.roles)) if (!COLOR.test(info.builtIn || '')) problems.push(`colors.roles.${role}: "${info.builtIn}" is not a color.`);
  for (const [id, theme] of Object.entries(colors.themes)) {
    if (!/^[a-z][a-z-]{1,30}$/.test(id) || !theme.label) problems.push(`colors.themes.${id}: needs a lowercase id and a label.`);
    for (const [role, value] of Object.entries(theme.colors || {})) {
      if (!colors.roles[role]) problems.push(`colors.themes.${id}: "${role}" is not a color role.`);
      if (!COLOR.test(value)) problems.push(`colors.themes.${id}.${role}: "${value}" is not a color.`);
    }
    for (const key of ['connected', 'disconnected']) if (!COLOR.test(theme.status?.[key] || '')) problems.push(`colors.themes.${id}.status.${key} is not a color.`);
  }
  const palette = ' const PALETTE={' + Object.entries(colors.roles).map(([k, v]) => `${k}:[${JSON.stringify(v.label).replace(/"/g, "'")},'${v.builtIn}']`).join(',') + '};';
  const presets = ' const PRESETS={\n' + Object.entries(colors.themes).map(([id, t]) => {
    const key = /^[a-z]+$/.test(id) ? id : `'${id}'`;
    const obj = o => '{' + Object.entries(o).map(([k, v]) => `${k}:'${v}'`).join(',') + '}';
    return `  ${key}:{label:'${t.label}',status:${obj(t.status)},colors:${obj(t.colors || {})}},`;
  }).join('\n') + '\n };';
  const themePath = path.join(root, 'theme.js');
  const themeSrc = readFileSync(themePath, 'utf8');
  const themeOut = themeSrc.replace(/ const PALETTE=\{.*?\};/s, palette).replace(/ const PRESETS=\{[\s\S]*?\n \};/, presets);
  const glassPath = path.join(root, 'glass-themes.css');
  const glassSrc = readFileSync(glassPath, 'utf8');
  let glassOut = glassSrc;
  for (const [id, t] of Object.entries(colors.themes)) if (t.glass) {
    const g = t.glass, line = `html[data-ecco-theme="${id}"]{color-scheme:${g.colorScheme};--glass-backdrop:${g.backdrop};--glass-solid:${g.solid};--glass-highlight:${g.highlight};--glass-shadow:${g.shadow}}`;
    const re = new RegExp(`^html\\[data-ecco-theme="${id}"\\]\\{color-scheme:.*$`, 'm');
    if (!re.test(glassOut)) problems.push(`glass-themes.css has no backdrop line for ${id}.`); else glassOut = glassOut.replace(re, line);
  }
  return [[themePath, themeSrc, themeOut], [glassPath, glassSrc, glassOut]];
}
const targets = [[path.join(root, 'design-system/sizes.css'), (() => { try { return readFileSync(path.join(root, 'design-system/sizes.css'), 'utf8'); } catch { return ''; } })(), css], ...themeFiles()];
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
if (process.argv.includes('--check')) {
  const stale = targets.filter(([, current, next]) => current !== next).map(([file]) => path.relative(root, file));
  if (stale.length) { console.error(stale.join(', ') + ' out of date. Run: node scripts/size_roster.mjs'); process.exit(1); }
  console.log(`Size roster OK: ${sizes.entries(roster).length} elements, ${Object.keys(roster.colors.themes).length} themes.`);
} else {
  for (const [file, current, next] of targets) if (current !== next) writeFileSync(file, next);
  console.log(`Wrote sizes.css, theme colors and glass backdrops from size-roster.json (${sizes.entries(roster).length} elements, ${Object.keys(roster.colors.themes).length} themes).`);
}
