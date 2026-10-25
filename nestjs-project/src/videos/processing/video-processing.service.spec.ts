import { Test } from '@nestjs/testing';
import { StorageService } from '../../storage/storage.service';
import { VideoRecordsService } from '../video-records.service';
import { VideoStatus } from '../entities/video.entity';
import { MediaInspectionService } from './media-inspection.service';
import { VideoProcessingService } from './video-processing.service';
import { InvalidMediaError } from './media.errors';

describe('VideoProcessingService', () => {
  const records = {
    findById: jest.fn(),
    reserveProcessingAttempt: jest.fn(),
    updateState: jest.fn(),
  };
  const storage = { headObject: jest.fn() };
  const media = { inspect: jest.fn() };
  let service: VideoProcessingService;
  beforeEach(async () => {
    jest.resetAllMocks();
    records.findById.mockResolvedValue({
      id: 'video',
      status: 'processing',
      original_key: 'known',
      declared_size: '1',
    });
    records.reserveProcessingAttempt.mockResolvedValue(1);
    records.updateState.mockResolvedValue(true);
    storage.headObject.mockResolvedValue({ size: 1 });
    media.inspect.mockResolvedValue({
      duration: 1,
      metadata: { video: { codec: 'h264' } },
      thumbnailKey: 'known-thumbnail',
    });
    const module = await Test.createTestingModule({
      providers: [
        VideoProcessingService,
        { provide: VideoRecordsService, useValue: records },
        { provide: StorageService, useValue: storage },
        { provide: MediaInspectionService, useValue: media },
      ],
    }).compile();
    service = module.get(VideoProcessingService);
    await module.close();
  });
  it.each([VideoStatus.DRAFT, VideoStatus.READY, VideoStatus.ERROR])(
    'should skip redelivery for %s',
    async (status) => {
      records.findById.mockResolvedValue({ status });
      await service.process('video');
      expect(records.reserveProcessingAttempt).not.toHaveBeenCalled();
      expect(media.inspect).not.toHaveBeenCalled();
    },
  );
  it('should verify originals before and after extraction and conditionally persist readiness', async () => {
    await service.process('video');
    expect(storage.headObject).toHaveBeenCalledTimes(2);
    expect(records.updateState).toHaveBeenCalledWith(
      'video',
      'processing',
      'ready',
      {
        duration: 1,
        metadata: { video: { codec: 'h264' } },
        thumbnail_key: 'known-thumbnail',
        failure_reason: null,
      },
    );
  });
  it('should treat a rejected ready update as stale without overwriting a terminal state', async () => {
    records.updateState.mockResolvedValue(false);
    await service.process('video');
    expect(records.updateState).toHaveBeenCalledTimes(1);
  });
  it('should consume no more than the reserved durable budget', async () => {
    records.reserveProcessingAttempt.mockResolvedValue(null);
    await expect(service.process('video')).rejects.toThrow('processing_failed');
    expect(media.inspect).not.toHaveBeenCalled();
    expect(records.updateState).toHaveBeenCalledWith(
      'video',
      'processing',
      'error',
      { failure_reason: 'processing_failed' },
    );
  });
  it('should fail invalid media immediately with the safe terminal reason', async () => {
    media.inspect.mockRejectedValue(new InvalidMediaError());
    await expect(service.process('video')).rejects.toMatchObject({
      name: 'UnrecoverableError',
      message: 'invalid_media',
    });
    expect(records.updateState).toHaveBeenCalledWith(
      'video',
      'processing',
      'error',
      { failure_reason: 'invalid_media' },
    );
  });
  it('should preserve transient failures until the final durable attempt', async () => {
    media.inspect.mockRejectedValue(new Error('private diagnostic'));
    await expect(service.process('video')).rejects.toThrow('processing_failed');
    expect(records.updateState).not.toHaveBeenCalled();
    records.reserveProcessingAttempt.mockResolvedValue(3);
    await expect(service.process('video')).rejects.toMatchObject({
      name: 'UnrecoverableError',
      message: 'processing_failed',
    });
  });
});
