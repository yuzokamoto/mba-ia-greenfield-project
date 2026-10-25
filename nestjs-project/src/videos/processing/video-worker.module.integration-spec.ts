import { AuthService } from '../../auth/auth.service';
import { createVideoWorkerTestContext } from '../../test/create-video-worker-test-context';

describe('VideoWorkerModule (integration)', () => {
  it('should boot/close an isolated application context without API/authentication or an HTTP listener', async () => {
    const context = await createVideoWorkerTestContext();
    const client = await context.workerQueue.client;
    try {
      expect(context.processor.worker.name).toBe('video-processing-test');
      expect(context.processor.worker.concurrency).toBe(1);
      expect(client.options.maxRetriesPerRequest).toBeNull();
      expect('getHttpServer' in context.app).toBe(false);
      expect(() => context.app.get(AuthService)).toThrow();
    } finally {
      await context.close();
    }
    expect(client.status).toBe('end');
  });
});
