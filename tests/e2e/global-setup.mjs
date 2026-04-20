import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FOUNDRY_ROOT = path.resolve(REPO_ROOT, '..', 'foundry');
const FOUNDRY_DATA = path.resolve(REPO_ROOT, '..', 'foundry-data');
const TEST_DATA = path.join(REPO_ROOT, 'tests', 'e2e', '.test-data');
const AUTH_DIR = path.join(REPO_ROOT, 'tests', 'e2e', '.auth');
const SEED_WORLD = path.join(REPO_ROOT, 'tests', 'e2e', 'fixtures', 'worlds', 'tb2e-e2e');
const PORT = 30001;
const PID_FILE = path.join(TEST_DATA, '.foundry.pid');

function assertNotTracked(relPath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relPath], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    throw new Error(
      `${relPath} is tracked by git. This directory holds credentials/session state and must be gitignored. Remove from git before running tests.`,
    );
  } catch (err) {
    if (err.status === 1) return;
    if (err.message?.startsWith(`${relPath} is tracked`)) throw err;
  }
}

async function waitForPort(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for Foundry at ${url}`);
}

export default async function globalSetup() {
  assertNotTracked('tests/e2e/.test-data');
  assertNotTracked('tests/e2e/.auth');

  if (!existsSync(FOUNDRY_ROOT)) {
    throw new Error(`Foundry v13 not found at ${FOUNDRY_ROOT}`);
  }
  if (!existsSync(FOUNDRY_DATA)) {
    throw new Error(`Foundry data dir not found at ${FOUNDRY_DATA}`);
  }

  await rm(TEST_DATA, { recursive: true, force: true });
  await mkdir(path.join(TEST_DATA, 'Config'), { recursive: true });
  await mkdir(path.join(TEST_DATA, 'Data', 'assets'), { recursive: true });
  await mkdir(path.join(TEST_DATA, 'Data', 'modules'), { recursive: true });
  await mkdir(path.join(TEST_DATA, 'Data', 'systems'), { recursive: true });
  await mkdir(path.join(TEST_DATA, 'Data', 'worlds'), { recursive: true });
  await mkdir(path.join(TEST_DATA, 'Logs'), { recursive: true });
  await mkdir(AUTH_DIR, { recursive: true });

  const srcLicense = path.join(FOUNDRY_DATA, 'Config', 'license.json');
  if (existsSync(srcLicense)) {
    await cp(srcLicense, path.join(TEST_DATA, 'Config', 'license.json'));
  }

  const options = {
    dataPath: TEST_DATA,
    compressStatic: true,
    fullscreen: false,
    hostname: null,
    language: 'en.core',
    localHostname: null,
    port: PORT,
    proxyPort: null,
    proxySSL: false,
    routePrefix: null,
    updateChannel: 'stable',
    upnp: false,
    awsConfig: null,
    compressSocket: true,
    cssTheme: 'dark',
    deleteNEDB: false,
    hotReload: false,
    passwordSalt: null,
    sslCert: null,
    sslKey: null,
    world: null,
    serviceConfig: null,
    telemetry: false,
  };
  await writeFile(
    path.join(TEST_DATA, 'Config', 'options.json'),
    JSON.stringify(options, null, 2),
  );

  await symlink(REPO_ROOT, path.join(TEST_DATA, 'Data', 'systems', 'tb2e'), 'dir');

  await cp(SEED_WORLD, path.join(TEST_DATA, 'Data', 'worlds', 'tb2e-e2e'), {
    recursive: true,
  });

  const logOut = path.join(TEST_DATA, 'Logs', 'foundry.out.log');
  const logErr = path.join(TEST_DATA, 'Logs', 'foundry.err.log');
  const { openSync } = await import('node:fs');
  const outFd = openSync(logOut, 'a');
  const errFd = openSync(logErr, 'a');

  const child = spawn(
    'node',
    [
      path.join(FOUNDRY_ROOT, 'main.js'),
      `--dataPath=${TEST_DATA}`,
      '--world=tb2e-e2e',
      `--port=${PORT}`,
      '--noupnp',
      '--headless',
    ],
    {
      cwd: FOUNDRY_ROOT,
      stdio: ['ignore', outFd, errFd],
      detached: true,
    },
  );
  child.unref();
  await writeFile(PID_FILE, String(child.pid));
  console.log(`[e2e] Spawned Foundry (pid ${child.pid}) on port ${PORT}`);

  await waitForPort(`http://localhost:${PORT}/`, 60_000);
  console.log(`[e2e] Foundry ready at http://localhost:${PORT}/`);
}
