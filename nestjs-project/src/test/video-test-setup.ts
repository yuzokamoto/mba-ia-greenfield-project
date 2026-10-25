import { applyVideoTestEnvironment } from './video-test-environment';
import { DataSource } from 'typeorm';
import databaseConfig from '../config/database.config';
import { VIDEO_MAINTENANCE_LOCK } from '../videos/processing/video-maintenance-lock';

const environment = applyVideoTestEnvironment();
let maintenance: DataSource | undefined;

beforeAll(async () => {
  const path = expect.getState().testPath ?? '';
  if (!/\.(integration-spec|e2e-spec)\.ts$/.test(path)) return;
  const config = databaseConfig();
  maintenance = new DataSource({
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database: config.name,
    extra: { max: 1 },
  });
  await maintenance.initialize();
  // Wait for any current scan before creating fixtures; connection close unlocks.
  await maintenance.query('SELECT pg_advisory_lock($1)', [
    VIDEO_MAINTENANCE_LOCK,
  ]);
});

afterAll(async () => {
  try {
    await environment.cleanup();
  } finally {
    if (maintenance?.isInitialized) await maintenance.destroy();
  }
});
