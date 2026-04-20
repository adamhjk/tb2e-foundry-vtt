import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEST_DATA = path.join(REPO_ROOT, 'tests', 'e2e', '.test-data');
const PID_FILE = path.join(TEST_DATA, '.foundry.pid');

async function waitForExit(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export default async function globalTeardown() {
  if (!existsSync(PID_FILE)) {
    console.log('[e2e] No PID file; Foundry already stopped');
    return;
  }
  const pid = Number((await readFile(PID_FILE, 'utf-8')).trim());
  if (!pid) return;

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[e2e] Sent SIGTERM to Foundry (pid ${pid})`);
    const exited = await waitForExit(pid, 10_000);
    if (!exited) {
      process.kill(pid, 'SIGKILL');
      console.log(`[e2e] Forced SIGKILL on Foundry (pid ${pid})`);
    }
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
  }

  if (!process.env.KEEP_TEST_DATA) {
    await rm(TEST_DATA, { recursive: true, force: true });
    console.log('[e2e] Removed scratch test data dir');
  } else {
    console.log('[e2e] KEEP_TEST_DATA set — leaving scratch dir in place');
  }
}
