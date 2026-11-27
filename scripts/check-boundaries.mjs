// Enforces loose coupling: which workspace may depend on which. Runs in CI.
// Change this table only with both developers' agreement (it is the architecture).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = {
  '@gsc/config': [],
  '@gsc/contracts': ['@gsc/config'],
  // Dev A — Experience
  '@gsc/ui': ['@gsc/config'],
  '@gsc/3d': ['@gsc/config', '@gsc/contracts'],
  '@gsc/web': ['@gsc/config', '@gsc/contracts', '@gsc/ui', '@gsc/3d'],
  // Dev B — Engine
  '@gsc/qualifier': ['@gsc/config', '@gsc/contracts'],
  '@gsc/messaging': ['@gsc/config', '@gsc/contracts'],
  '@gsc/crm': ['@gsc/config', '@gsc/contracts'],
  '@gsc/db': ['@gsc/config', '@gsc/contracts'],
  '@gsc/api': ['@gsc/config', '@gsc/contracts', '@gsc/qualifier', '@gsc/messaging', '@gsc/crm', '@gsc/db'],
  '@gsc/dashboard': ['@gsc/config', '@gsc/contracts', '@gsc/ui'],
};

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let failed = false;
for (const group of ['apps', 'packages']) {
  for (const dir of readdirSync(join(root, group))) {
    const pj = join(root, group, dir, 'package.json');
    if (!existsSync(pj)) continue;
    const pkg = JSON.parse(readFileSync(pj, 'utf8'));
    const allowed = ALLOWED[pkg.name];
    if (!allowed) {
      console.error(`✗ ${pkg.name} is not in the boundary table (scripts/check-boundaries.mjs)`);
      failed = true;
      continue;
    }
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => d.startsWith('@gsc/'));
    for (const d of deps) {
      if (!allowed.includes(d)) {
        console.error(`✗ ${pkg.name} must not depend on ${d}`);
        failed = true;
      }
    }
  }
}
if (failed) process.exit(1);
console.log('✓ workspace boundaries OK');
