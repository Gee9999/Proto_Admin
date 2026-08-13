#!/usr/bin/env node
/**
 * Deploy ONLY the protoportal-admin Vercel project.
 * Never run bare `vercel deploy` — the CLI may target protoportal-main.
 */
import { spawnSync } from 'node:child_process';

const ADMIN_PROJECT_ID = 'prj_tpEwYIxCWnUxH9yIX9c6vxXuivB4';

/**
 * The project moved from the personal team to the `proto-team` team, which
 * left the old hard-coded VERCEL_ORG_ID pointing at a team that no longer
 * holds it — the API answers 404 there. `--scope` takes the team slug and is
 * the stable way to name the owner, so it is the default. VERCEL_ORG_ID from
 * the environment still wins, which keeps CI and a future team move working
 * without another code change.
 */
const ADMIN_SCOPE = process.env.VERCEL_ADMIN_SCOPE || 'proto-team';

const env = {
  ...process.env,
  VERCEL_PROJECT_ID: ADMIN_PROJECT_ID,
};

const scopeArgs = process.env.VERCEL_ORG_ID ? [] : ['--scope', ADMIN_SCOPE];

console.log(`Deploying protoportal-admin (NOT protoportal-main)${scopeArgs.length ? ` — scope ${ADMIN_SCOPE}` : ''}…`);

const result = spawnSync(
  'npx',
  ['vercel@latest', 'deploy', '--prod', '--yes', ...scopeArgs],
  { env, stdio: 'pipe', encoding: 'utf8' },
);

const out = `${result.stdout || ''}\n${result.stderr || ''}`;
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');

if (result.status !== 0) {
  process.exit(result.status || 1);
}

if (/protoportal-main/i.test(out) && !/protoportal-admin/i.test(out)) {
  console.error('\nERROR: Deployment targeted protoportal-main. Aborting.');
  process.exit(1);
}

if (!/protoportal-admin/i.test(out)) {
  console.error('\nWARN: Could not confirm protoportal-admin in deploy output — verify in Vercel dashboard.');
}

console.log('\nOK: protoportal-admin production deploy finished.');
