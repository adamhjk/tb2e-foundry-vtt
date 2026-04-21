import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FOUNDRY_ROOT = path.resolve(REPO_ROOT, '..', 'foundry');
const FOUNDRY_DATA = path.resolve(REPO_ROOT, '..', 'foundry-data');
const AUTH_DIR = path.join(REPO_ROOT, 'tests', 'e2e', '.auth');
const SEED_WORLD = path.join(REPO_ROOT, 'tests', 'e2e', 'fixtures', 'worlds', 'tb2e-e2e');

// Keep test data outside Playwright's `testDir` (tests/e2e). Foundry's data
// tree contains a symlink back to the repo root; if it lived inside testDir
// the UI-mode file watcher would recurse into node_modules and OOM.
const PORT_BASE = Number(process.env.E2E_PORT_BASE ?? 30001);
const WORKERS = Number(process.env.E2E_WORKERS ?? 8);
const PID_FILE = path.join(REPO_ROOT, '.e2e-pids');

const dataDirFor = (i) => path.join(REPO_ROOT, `.e2e-test-data-${i}`);
const portFor = (i) => PORT_BASE + i;

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

async function waitForPort(url, timeoutMs = 90_000) {
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

async function spawnFoundryForWorker(i, srcLicense) {
  const dataDir = dataDirFor(i);
  const port = portFor(i);

  await rm(dataDir, { recursive: true, force: true });
  await mkdir(path.join(dataDir, 'Config'), { recursive: true });
  await mkdir(path.join(dataDir, 'Data', 'assets'), { recursive: true });
  await mkdir(path.join(dataDir, 'Data', 'modules'), { recursive: true });
  await mkdir(path.join(dataDir, 'Data', 'systems'), { recursive: true });
  await mkdir(path.join(dataDir, 'Data', 'worlds'), { recursive: true });
  await mkdir(path.join(dataDir, 'Logs'), { recursive: true });

  if (srcLicense) {
    await cp(srcLicense, path.join(dataDir, 'Config', 'license.json'));
  }

  const options = {
    dataPath: dataDir,
    compressStatic: true,
    fullscreen: false,
    hostname: null,
    language: 'en.core',
    localHostname: null,
    port,
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
  await writeFile(path.join(dataDir, 'Config', 'options.json'), JSON.stringify(options, null, 2));

  // Build a per-worker system directory: symlink everything from REPO_ROOT
  // except `packs/`, which we copy. Foundry opens the system's LevelDB packs
  // with a LOCK file; N Foundries sharing the same packs/ via one symlink
  // contend on that lock and fail to load compendium entries. Giving each
  // worker its own packs/ copy isolates them. Packs are ~4 MB so this is
  // cheap. Skip hidden entries (.git, .e2e-test-data-*, .auth) and
  // node_modules — Foundry doesn't need them at runtime.
  const workerSystemDir = path.join(dataDir, 'Data', 'systems', 'tb2e');
  await mkdir(workerSystemDir, { recursive: true });
  const repoEntries = await readdir(REPO_ROOT, { withFileTypes: true });
  for (const entry of repoEntries) {
    if (entry.name === 'packs') continue;
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    await symlink(
      path.join(REPO_ROOT, entry.name),
      path.join(workerSystemDir, entry.name),
      entry.isDirectory() ? 'dir' : 'file',
    );
  }
  await cp(path.join(REPO_ROOT, 'packs'), path.join(workerSystemDir, 'packs'), { recursive: true });

  await cp(SEED_WORLD, path.join(dataDir, 'Data', 'worlds', 'tb2e-e2e'), { recursive: true });

  const outFd = openSync(path.join(dataDir, 'Logs', 'foundry.out.log'), 'a');
  const errFd = openSync(path.join(dataDir, 'Logs', 'foundry.err.log'), 'a');

  const child = spawn(
    'node',
    [
      path.join(FOUNDRY_ROOT, 'main.js'),
      `--dataPath=${dataDir}`,
      '--world=tb2e-e2e',
      `--port=${port}`,
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

  await waitForPort(`http://localhost:${port}/`, 90_000);
  console.log(`[e2e] Foundry worker ${i} ready (pid ${child.pid}, port ${port})`);
  return child.pid;
}

export default async function globalSetup() {
  for (let i = 0; i < WORKERS; i++) {
    assertNotTracked(`.e2e-test-data-${i}`);
  }
  assertNotTracked('tests/e2e/.auth');

  if (!existsSync(FOUNDRY_ROOT)) {
    throw new Error(`Foundry v13 not found at ${FOUNDRY_ROOT}`);
  }
  if (!existsSync(FOUNDRY_DATA)) {
    throw new Error(`Foundry data dir not found at ${FOUNDRY_DATA}`);
  }

  await mkdir(AUTH_DIR, { recursive: true });

  const srcLicense = path.join(FOUNDRY_DATA, 'Config', 'license.json');
  const licenseToCopy = existsSync(srcLicense) ? srcLicense : null;

  console.log(`[e2e] Spawning ${WORKERS} Foundry instance(s) on ports ${portFor(0)}..${portFor(WORKERS - 1)}`);
  const pids = await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => spawnFoundryForWorker(i, licenseToCopy)),
  );

  await writeFile(PID_FILE, pids.join('\n') + '\n');
  console.log(`[e2e] All ${WORKERS} Foundry instance(s) ready`);
}
