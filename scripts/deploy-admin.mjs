#!/usr/bin/env node
/**
 * Deploy ONLY the protoportal-admin Vercel project.
 * Never run bare `vercel deploy` — the CLI may target protoportal-main.
 */
import { spawnSync } from 'node:child_process';

const ADMIN_PROJECT_ID = 'prj_tpEwYIxCWnUxH9yIX9c6vxXuivB4';
const ADMIN_ORG_ID = 'team_eCbNLKm2ZVG4tK6WSXq7vzbr';

const env = {
  ...process.env,
  VERCEL_PROJECT_ID: ADMIN_PROJECT_ID,
  VERCEL_ORG_ID: ADMIN_ORG_ID,
};

console.log('Deploying protoportal-admin (NOT protoportal-main)…');

const result = spawnSync(
  'npx',
  ['vercel@latest', 'deploy', '--prod', '--yes'],
  { env, stdio: 'pipe', encoding: 'utf8' },
);

const out = `${result.stdout || ''}\n${result.stderr || ''}`;
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');

if (result.status !== 0) {
  process.exit(result.status || 1);
}

if (/site\.proto\.co\.za/i.test(out)) {
  console.error('\nERROR: Deploy output aliases site.proto.co.za (main portal). Aborting.');
  process.exit(1);
}

if (/protoportal-main/i.test(out) && !/protoportal-admin/i.test(out)) {
  console.error('\nERROR: Deployment targeted protoportal-main. Aborting.');
  process.exit(1);
}

if (!/protoportal-admin/i.test(out)) {
  console.error('\nWARN: Could not confirm protoportal-admin in deploy output — verify in Vercel dashboard.');
}

console.log('\nOK: protoportal-admin production deploy finished.');
