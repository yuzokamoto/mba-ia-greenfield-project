import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { CreateVideosAndUploadSessions1792893518686 } from './migrations/1792893518686-CreateVideosAndUploadSessions';
import { createTestDataSource } from '../test/create-test-data-source';
import { VIDEO_TEST_ENTITIES } from '../test/video-test-data';

const MANAGED_TABLES = [
  'upload_sessions',
  'videos',
  'refresh_tokens',
  'verification_tokens',
  'channels',
  'users',
];
const VIDEO_ENUM_TYPES = ['videos_status_enum', 'upload_sessions_status_enum'];
const MANAGED_ENUM_TYPES = [
  ...VIDEO_ENUM_TYPES,
  'verification_tokens_type_enum',
];

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(VIDEO_TEST_ENTITIES, {
      synchronize: false,
      migrations: [
        CreateUsersAndChannels1775687773260,
        CreateAuthTokens1777579850478,
        CreateVideosAndUploadSessions1792893518686,
      ],
    });
    await dataSource.initialize();
    // Shared database suites run serially; this suite exercises an empty schema.
    for (const table of [...MANAGED_TABLES, 'migrations']) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    for (const enumType of MANAGED_ENUM_TYPES) {
      await dataSource.query(`DROP TYPE IF EXISTS "public"."${enumType}"`);
    }
  });

  afterAll(async () => {
    try {
      await dataSource.runMigrations();
    } finally {
      await dataSource.destroy();
    }
  });

  it('should apply the full migration chain to an empty schema', async () => {
    expect(await dataSource.runMigrations()).toHaveLength(3);
    const rows = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    expect(rows.map((row) => row.table_name)).toEqual(
      [...MANAGED_TABLES].sort(),
    );
    const checks = await dataSource.query<{ definition: string }[]>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname IN ($1, $2) ORDER BY conname`,
      ['CHK_videos_declared_size', 'CHK_upload_sessions_part_size'],
    );
    expect(checks).toHaveLength(2);
    expect(checks.map((row) => row.definition).join(' ')).toContain(
      '10737418240',
    );
    expect(checks.map((row) => row.definition).join(' ')).toContain(
      'part_size > 0',
    );
  });

  it('should revert only the video migration, remove its enums, and preserve existing auth records', async () => {
    const user = await dataSource.getRepository(User).save({
      email: 'migration-preserve@example.com',
      password: 'fixture-hash',
    });
    const token = await dataSource.getRepository(RefreshToken).save({
      user_id: user.id,
      family: randomUUID(),
      token_hash: 'preserved-token-hash',
      expires_at: new Date(Date.now() + 60000),
    });
    await dataSource.undoLastMigration();
    const tables = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [['videos', 'upload_sessions']],
    );
    expect(tables).toHaveLength(0);
    const enums = await dataSource.query<{ typname: string }[]>(
      `SELECT typname FROM pg_type WHERE typname = ANY($1::text[])`,
      [VIDEO_ENUM_TYPES],
    );
    expect(enums).toHaveLength(0);
    expect(
      await dataSource.getRepository(RefreshToken).findOneBy({ id: token.id }),
    ).toMatchObject({ user_id: user.id });
    expect(
      await dataSource.getRepository(User).findOneBy({ id: user.id }),
    ).not.toBeNull();
  });

  it('should reapply the generated migration with constraints and both enums intact', async () => {
    expect(await dataSource.runMigrations()).toHaveLength(1);
    const enums = await dataSource.query<{ typname: string }[]>(
      `SELECT typname FROM pg_type WHERE typname = ANY($1::text[])`,
      [VIDEO_ENUM_TYPES],
    );
    expect(enums).toHaveLength(2);
    expect(await dataSource.showMigrations()).toBe(false);
  });
});
