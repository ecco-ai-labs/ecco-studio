#!/usr/bin/env node
// Builds design-system/sizes.css from design-system/size-roster.json.
//   node scripts/size_roster.mjs          regenerate
//   node scripts/size_roster.mjs --check  fail when sizes.css is stale or the roster is invalid
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

const target = path.join(root, 'design-system/sizes.css');
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch {}
  if (current !== css) {
    console.error('design-system/sizes.css is out of date. Run: node scripts/size_roster.mjs');
    process.exit(1);
  }
  console.log(`Size roster OK: ${sizes.entries(roster).length} elements.`);
} else {
  writeFileSync(target, css);
  console.log(`Wrote design-system/sizes.css from ${sizes.entries(roster).length} roster elements.`);
}
