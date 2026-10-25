import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import videoConfig from '../../config/video.config';
import { VideoProcessingProducer } from '../queue/video-processing-producer.service';
import { UploadSessionsService } from '../uploads/upload-sessions.service';
import { UploadTerminationService } from '../uploads/upload-termination.service';
import { VideoRecordsService } from '../video-records.service';
import { VideoReconcilerService } from './video-reconciler.service';

describe('VideoReconcilerService', () => {
  const sessions = { findExpiredActive: jest.fn() };
  const termination = { resolveExpired: jest.fn() };
  const records = {
    findProcessing: jest.fn(),
    findById: jest.fn(),
    updateState: jest.fn(),
  };
  const producer = { enqueue: jest.fn(), findJob: jest.fn() };
  const job = { getState: jest.fn(), remove: jest.fn(), failedReason: '' };
  let module: TestingModule;
  let reconciler: VideoReconcilerService;
  let warnings: jest.SpyInstance;
  beforeEach(async () => {
    jest.resetAllMocks();
    sessions.findExpiredActive.mockResolvedValue([]);
    records.findProcessing.mockResolvedValue([{ id: 'video' }]);
    records.findById.mockResolvedValue({
      id: 'video',
      status: 'processing',
      processing_attempts: 1,
    });
    records.updateState.mockResolvedValue(true);
    producer.findJob.mockResolvedValue(undefined);
    job.failedReason = '';
    warnings = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    module = await Test.createTestingModule({
      providers: [
        VideoReconcilerService,
        { provide: UploadSessionsService, useValue: sessions },
        { provide: UploadTerminationService, useValue: termination },
        { provide: VideoRecordsService, useValue: records },
        { provide: VideoProcessingProducer, useValue: producer },
        { provide: videoConfig.KEY, useValue: { reconcileIntervalMs: 10 } },
      ],
    }).compile();
    reconciler = module.get(VideoReconcilerService);
  });
  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it.each([
    'waiting',
    'active',
    'delayed',
    'prioritized',
    'waiting-children',
    'unknown',
  ])('should preserve %s queue evidence', async (state) => {
    producer.findJob.mockResolvedValue(job);
    job.getState.mockResolvedValue(state);
    await reconciler.tick();
    expect(producer.enqueue).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
    expect(records.updateState).not.toHaveBeenCalled();
  });
  it('should recreate missing jobs with only the remaining durable budget', async () => {
    await reconciler.tick();
    expect(producer.enqueue).toHaveBeenCalledWith('video', 2);
  });
  it('should inspect and remove only completed evidence before same-ID recovery', async () => {
    producer.findJob.mockResolvedValue(job);
    job.getState.mockResolvedValue('completed');
    await reconciler.tick();
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(producer.enqueue).toHaveBeenCalledWith('video', 2);
    expect(job.remove.mock.invocationCallOrder[0]).toBeLessThan(
      producer.enqueue.mock.invocationCallOrder[0],
    );
  });
  it.each([undefined, 'completed'])(
    'should terminate exhausted intent with evidence %s',
    async (state) => {
      records.findById.mockResolvedValue({
        id: 'video',
        status: 'processing',
        processing_attempts: 3,
      });
      if (state) {
        producer.findJob.mockResolvedValue(job);
        job.getState.mockResolvedValue(state);
      }
      await reconciler.tick();
      expect(records.updateState).toHaveBeenCalledWith(
        'video',
        'processing',
        'error',
        { failure_reason: 'processing_failed' },
      );
      expect(producer.enqueue).not.toHaveBeenCalled();
      expect(job.remove).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['invalid_media', 'invalid_media'],
    ['redis://private/secret', 'processing_failed'],
  ])(
    'should classify retained failed reason safely: %s',
    async (failedReason, expected) => {
      producer.findJob.mockResolvedValue(job);
      job.getState.mockResolvedValue('failed');
      job.failedReason = failedReason;
      await reconciler.tick();
      expect(records.updateState).toHaveBeenCalledWith(
        'video',
        'processing',
        'error',
        { failure_reason: expected },
      );
      expect(producer.enqueue).not.toHaveBeenCalled();
      expect(job.remove).not.toHaveBeenCalled();
    },
  );
  it.each(['ready', 'error', null])(
    'should reject stale processing scans for %s',
    async (status) => {
      records.findById.mockResolvedValue(status ? { status } : null);
      await reconciler.tick();
      expect(records.updateState).not.toHaveBeenCalled();
      expect(producer.enqueue).not.toHaveBeenCalled();
    },
  );
  it.each(['lookup', 'state', 'removal'])(
    'should preserve undecided state when queue %s fails',
    async (failure) => {
      const error = new Error('redis://private/secret');
      if (failure === 'lookup') producer.findJob.mockRejectedValue(error);
      else {
        producer.findJob.mockResolvedValue(job);
        if (failure === 'state') job.getState.mockRejectedValue(error);
        else {
          job.getState.mockResolvedValue('completed');
          job.remove.mockRejectedValue(error);
        }
      }
      await reconciler.tick();
      expect(records.updateState).not.toHaveBeenCalled();
      expect(producer.enqueue).not.toHaveBeenCalled();
      expect(warnings).toHaveBeenCalledWith(
        'Processing reconciliation deferred; dependency inspection or publication failed',
      );
    },
  );
  it('should publish recovered expiry only after the shared resolver commits', async () => {
    sessions.findExpiredActive.mockResolvedValue([
      { video_id: 'expired' },
      { video_id: 'terminal' },
      { video_id: 'absent' },
    ]);
    termination.resolveExpired
      .mockResolvedValueOnce({ video: { id: 'expired' }, publish: true })
      .mockResolvedValueOnce({ publish: false })
      .mockResolvedValueOnce(null);
    records.findProcessing.mockResolvedValue([]);
    await reconciler.tick();
    expect(producer.enqueue).toHaveBeenCalledTimes(1);
    expect(producer.enqueue).toHaveBeenCalledWith('expired');
    expect(termination.resolveExpired.mock.invocationCallOrder[0]).toBeLessThan(
      producer.enqueue.mock.invocationCallOrder[0],
    );
  });
  it('should defer an unavailable expiry and continue other decisions', async () => {
    sessions.findExpiredActive.mockResolvedValue([{ video_id: 'expired' }]);
    termination.resolveExpired.mockRejectedValue(
      new Error('private storage failure'),
    );
    await reconciler.tick();
    expect(producer.enqueue).toHaveBeenCalledWith('video', 2);
    expect(warnings).toHaveBeenCalledWith(
      'Upload reconciliation deferred; dependency inspection or publication failed',
    );
  });
  it('should not interpret a failed scan as absence', async () => {
    sessions.findExpiredActive.mockRejectedValue(new Error('database offline'));
    await reconciler.tick();
    expect(records.findProcessing).not.toHaveBeenCalled();
    expect(producer.enqueue).not.toHaveBeenCalled();
    expect(warnings).toHaveBeenCalledWith('Video reconciliation scan deferred');
  });
  it('should own one non-overlapping timer and await an in-flight tick during shutdown', async () => {
    jest.useFakeTimers();
    let release!: () => void;
    sessions.findExpiredActive.mockImplementation(
      () =>
        new Promise<never[]>((resolve) => {
          release = () => resolve([]);
        }),
    );
    reconciler.onModuleInit();
    await jest.advanceTimersByTimeAsync(30);
    expect(sessions.findExpiredActive).toHaveBeenCalledTimes(1);
    const pending = reconciler.tick();
    let closed = false;
    const shutdown = reconciler.onModuleDestroy().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await pending;
    await shutdown;
    await jest.advanceTimersByTimeAsync(100);
    await reconciler.tick();
    expect(closed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(sessions.findExpiredActive).toHaveBeenCalledTimes(1);
    expect(producer.enqueue).not.toHaveBeenCalled();
  });
});
