export const ADMIN_STARTUP_TIMEOUT_MS = 8_000;
export const ADMIN_CHUNK_TIMEOUT_MS = 15_000;

export class StartupTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} did not finish within ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = 'StartupTimeoutError';
    this.code = 'startup_timeout';
    this.timeoutMs = timeoutMs;
  }
}

/** Bound startup work so the Admin UI can always leave its loading state. */
export function withStartupTimeout(task, {
  timeoutMs = ADMIN_STARTUP_TIMEOUT_MS,
  label = 'Admin startup',
} = {}) {
  let timer;
  const work = Promise.resolve().then(() => (
    typeof task === 'function' ? task() : task
  ));
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StartupTimeoutError(label, timeoutMs)), timeoutMs);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export function isMissingAuthSession(error) {
  const name = String(error?.name || '');
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  return name === 'AuthSessionMissingError'
    || code === 'session_not_found'
    || /auth session missing|no current session/i.test(message);
}

export function startupErrorMessage(error) {
  if (error?.code === 'startup_timeout') {
    return 'Session verification took too long. The Admin site is online, but its secure connection did not finish.';
  }
  return 'The Admin site loaded, but it could not verify the secure session. This is usually temporary.';
}
