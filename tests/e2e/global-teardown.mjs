import { readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PID_FILE = path.join(REPO_ROOT, '.e2e-pids');

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

async function stopPid(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (err.code === 'ESRCH') return;
    throw err;
  }
  const exited = await waitForExit(pid, 10_000);
  if (!exited) {
    try {
      process.kill(pid, 'SIGKILL');
      console.log(`[e2e] Forced SIGKILL on Foundry (pid ${pid})`);
    } catch (err) {
      if (err.code !== 'ESRCH') throw err;
    }
  }
}

export default async function globalTeardown() {
  if (!existsSync(PID_FILE)) {
    console.log('[e2e] No PID file; Foundry already stopped');
    return;
  }
  const pids = (await readFile(PID_FILE, 'utf-8'))
    .split('\n')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!pids.length) return;

  console.log(`[e2e] Stopping ${pids.length} Foundry instance(s): ${pids.join(', ')}`);
  await Promise.all(pids.map(stopPid));
  await rm(PID_FILE, { force: true });

  if (process.env.KEEP_TEST_DATA) {
    console.log('[e2e] KEEP_TEST_DATA set — leaving scratch dirs in place');
    return;
  }

  const entries = await readdir(REPO_ROOT, { withFileTypes: true });
  const dataDirs = entries
    .filter((d) => d.isDirectory() && /^\.e2e-test-data-\d+$/.test(d.name))
    .map((d) => path.join(REPO_ROOT, d.name));
  await Promise.all(dataDirs.map((d) => rm(d, { recursive: true, force: true })));
  console.log(`[e2e] Removed ${dataDirs.length} scratch test data dir(s)`);
}
