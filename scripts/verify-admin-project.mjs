#!/usr/bin/env node
/**
 * Abort Vercel builds when this admin repo is linked to the wrong project.
 * Prevents accidental admin deploys to protoportal-main / site.proto.co.za.
 */
const ADMIN_PROJECT_ID = 'prj_tpEwYIxCWnUxH9yIX9c6vxXuivB4';
const MAIN_PROJECT_ID = 'prj_tKIHSgHSenXJuEf8DdpKUYPVZhnu';

const projectId = process.env.VERCEL_PROJECT_ID || '';
const onRemoteVercelBuild =
  (process.env.VERCEL === '1' || process.env.VERCEL === 'true')
  && Boolean(process.env.VERCEL_URL);
if (!onRemoteVercelBuild || !projectId) process.exit(0);

if (projectId === MAIN_PROJECT_ID) {
  console.error(
    '\nFATAL: protoportal-admin must NOT build on protoportal-main (site.proto.co.za).\n'
    + 'Use: npm run deploy:admin\n',
  );
  process.exit(1);
}

if (projectId !== ADMIN_PROJECT_ID) {
  console.error(
    `\nFATAL: Unexpected Vercel project ${projectId}.\n`
    + `Expected protoportal-admin (${ADMIN_PROJECT_ID}).\n`,
  );
  process.exit(1);
}
