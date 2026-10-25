import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import databaseConfig from '../../config/database.config';
import { withVideoMaintenanceLock } from './video-maintenance-lock';

describe('Video maintenance gate (integration)', () => {
  it('should exclude scheduled scans on a separate connection while fixtures hold the lock', async () => {
    const config = databaseConfig();
    const source = new DataSource({
      type: 'postgres',
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      database: config.name,
    });
    const module = await Test.createTestingModule({
      providers: [{ provide: DataSource, useValue: source }],
    }).compile();
    try {
      await source.initialize();
      const action = jest.fn();
      await withVideoMaintenanceLock(source, action);
      expect(action).not.toHaveBeenCalled();
    } finally {
      if (source.isInitialized) await source.destroy();
      await module.close();
    }
  });
});
