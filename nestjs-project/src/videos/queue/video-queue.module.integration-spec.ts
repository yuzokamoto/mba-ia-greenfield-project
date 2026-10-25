import { Logger } from '@nestjs/common';
import queueConfig from '../../config/queue.config';
import { createVideoQueueTestContext } from '../../test/create-video-queue-test-context';

describe('VideoQueueModule (integration)', () => {
  it('should initialize the real configured producer without registering a worker and close its connection', async () => {
    const context = await createVideoQueueTestContext();
    const client = await context.queue.client;
    try {
      expect(context.queue.name).toBe('video-processing-test');
      expect(context.queue.name).toBe(queueConfig().name);
      expect(client.status).toBe('ready');
      expect(client.options).toMatchObject({
        host: 'redis',
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 2000,
      });
      expect(await context.queue.getWorkers()).toHaveLength(0);
    } finally {
      await context.close();
    }
    expect(client.status).toBe('end');
  });

  it('should attach bounded credential-free error diagnostics and remove owned listeners on shutdown', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const context = await createVideoQueueTestContext();
    try {
      context.queue.emit(
        'error',
        new Error('private redis credential and connection string'),
      );
      expect(warn).toHaveBeenCalledWith(
        'Video processing queue connection error',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    } finally {
      await context.close();
      warn.mockRestore();
    }
  });
});
