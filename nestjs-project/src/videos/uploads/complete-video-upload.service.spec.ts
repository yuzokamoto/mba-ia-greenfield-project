import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { VideoProcessingProducer } from '../queue/video-processing-producer.service';
import { VideoQueueUnavailableError } from '../queue/video-queue-unavailable.error';
import { VideoRecordsService } from '../video-records.service';
import { UploadFinalizationService } from './upload-finalization.service';
import { CompleteVideoUploadService } from './complete-video-upload.service';

describe('CompleteVideoUploadService', () => {
  const finalizer = { complete: jest.fn() };
  const publisher = { enqueue: jest.fn() };
  const records = { toResponse: jest.fn() };
  let service: CompleteVideoUploadService;
  beforeEach(async () => {
    jest.resetAllMocks();
    finalizer.complete.mockResolvedValue({
      video: { id: 'video' },
      publish: true,
    });
    publisher.enqueue.mockResolvedValue({});
    records.toResponse.mockReturnValue({ status: 'processing' });
    const module = await Test.createTestingModule({
      providers: [
        CompleteVideoUploadService,
        { provide: UploadFinalizationService, useValue: finalizer },
        { provide: VideoProcessingProducer, useValue: publisher },
        { provide: VideoRecordsService, useValue: records },
      ],
    }).compile();
    service = module.get(CompleteVideoUploadService);
    await module.close();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it('should publish only after the finalizer transaction resolves', async () => {
    finalizer.complete.mockImplementation(() => {
      expect(publisher.enqueue).not.toHaveBeenCalled();
      return Promise.resolve({ video: { id: 'video' }, publish: true });
    });
    expect(await service.complete('abcdefghijkl', 'owner', [])).toEqual({
      status: 'processing',
    });
    expect(publisher.enqueue).toHaveBeenCalledWith('video');
  });
  it('should return repeated completion without publishing another job', async () => {
    finalizer.complete.mockResolvedValue({
      video: { id: 'video' },
      publish: false,
    });
    await service.complete('abcdefghijkl', 'owner', []);
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });
  it('should preserve the durable result and log only a fixed safe diagnostic when Redis is unavailable', async () => {
    publisher.enqueue.mockRejectedValue(
      new VideoQueueUnavailableError(new Error('private Redis credentials')),
    );
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    expect(await service.complete('abcdefghijkl', 'owner', [])).toEqual({
      status: 'processing',
    });
    expect(warn.mock.calls).toEqual([
      ['Video processing publication deferred'],
    ]);
  });
  it('should propagate unrelated enqueue failures after commit', async () => {
    const error = new Error('unexpected');
    publisher.enqueue.mockRejectedValue(error);
    await expect(service.complete('abcdefghijkl', 'owner', [])).rejects.toBe(
      error,
    );
  });
  it('should not publish when finalization fails', async () => {
    const error = new Error('verification failed');
    finalizer.complete.mockRejectedValue(error);
    await expect(service.complete('abcdefghijkl', 'owner', [])).rejects.toBe(
      error,
    );
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });
});
