// Development supervisor: keep worker output independent of Nest's deleteOutDir.
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, openSync, closeSync } = require('node:fs');
const { join } = require('node:path');

const output = '/tmp/streamtube-video-worker';
const buildLog = '/tmp/video-worker-build.log';
let child;
let stopping = false;
let wake;
let lastStatus;
function status(message) {
  if (message !== lastStatus) console.log(message);
  lastStatus = message;
}
function stop() {
  stopping = true;
  child?.kill('SIGTERM');
  wake?.();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
function backoff() {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}
async function schemaReady() {
  // npm ci may not have run yet. Do not load checkout dependencies at file scope.
  for (const name of [
    'typescript',
    '@nestjs/core',
    'typeorm',
    'bullmq',
    'pg',
  ]) {
    if (!existsSync(join(process.cwd(), 'node_modules', name, 'package.json')))
      return false;
  }
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'streamtube',
    password: process.env.DB_PASSWORD || 'streamtube',
    database: process.env.DB_NAME || 'streamtube',
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  });
  try {
    await client.connect();
    await client.query(
      'SELECT v.processing_attempts, s.expires_at FROM videos v, upload_sessions s LIMIT 0',
    );
    return true;
  } finally {
    await client.end();
  }
}
function run(args, stdio) {
  return new Promise((resolve) => {
    child = spawn(process.execPath, args, {
      stdio,
      env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') },
    });
    child.once('error', () => resolve(1));
    child.once('close', (code) => {
      child = undefined;
      resolve(code);
    });
  });
}
async function main() {
  while (!stopping) {
    let ready = false;
    try {
      ready = await schemaReady();
    } catch {
      /* Setup is still pending. */
    }
    if (stopping) break;
    if (!ready) {
      status(
        'Video worker waiting for dependencies and migrations (retry every 5s)',
      );
      await backoff();
      continue;
    }
    // Recompile on container start/restart, without writing shared dist/ or tsbuildinfo.
    mkdirSync(output, { recursive: true });
    const log = openSync(buildLog, 'w');
    status('Video worker building private entrypoint');
    const built = await run(
      [
        'node_modules/typescript/bin/tsc',
        '-p',
        'tsconfig.build.json',
        '--outDir',
        output,
        '--incremental',
        'false',
      ],
      ['ignore', log, log],
    );
    closeSync(log);
    if (stopping) break;
    if (built !== 0) {
      status(`Video worker build deferred; see ${buildLog} (retry every 5s)`);
      await backoff();
      continue;
    }
    await run([join(output, 'video-worker.js')], 'inherit');
    if (!stopping) {
      status('Video worker exited; retry in 5s');
      await backoff();
    }
  }
}
void main().catch(() => {
  console.error('Video worker supervisor failed');
  process.exitCode = 1;
});
