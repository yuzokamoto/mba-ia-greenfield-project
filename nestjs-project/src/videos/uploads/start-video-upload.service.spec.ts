import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ChannelsService } from '../../channels/channels.service';
import { ChannelNotFoundException } from '../../channels/exceptions/channel-not-found.exception';
import { StorageUnavailableException } from '../../common/exceptions/storage-unavailable.exception';
import { StorageService } from '../../storage/storage.service';
import { PublicIdGenerator } from '../public-id';
import { VideoRecordsService } from '../video-records.service';
import { UploadSessionsService } from './upload-sessions.service';
import { StartVideoUploadService } from './start-video-upload.service';

describe('StartVideoUploadService', () => {
  const input = {
    title: 'Video',
    original_filename: 'video.mp4',
    content_type: 'video/mp4',
    declared_size: 10,
  };
  let service: StartVideoUploadService;
  const channels = { findOwnedByUserId: jest.fn() };
  const storage = { createMultipart: jest.fn(), abortMultipart: jest.fn() };
  const records = { createDraft: jest.fn(), toResponse: jest.fn() };
  const sessions = { create: jest.fn(), toResponse: jest.fn() };
  const transaction = jest.fn();
  const manager = {};
  beforeEach(async () => {
    jest.resetAllMocks();
    channels.findOwnedByUserId.mockResolvedValue({ id: 'own-channel' });
    storage.createMultipart.mockImplementation((key: string) =>
      Promise.resolve({ key, uploadId: 'private-upload' }),
    );
    storage.abortMultipart.mockResolvedValue('aborted');
    records.createDraft.mockResolvedValue({ id: 'draft', declared_size: '10' });
    records.toResponse.mockReturnValue({ public_id: 'abcdefghijkl' });
    sessions.create.mockResolvedValue({ id: 'session' });
    sessions.toResponse.mockReturnValue({ id: 'session' });
    transaction.mockImplementation(
      async (work: (manager: object) => Promise<unknown>) =>
        await work(manager),
    );
    const module = await Test.createTestingModule({
      providers: [
        StartVideoUploadService,
        { provide: DataSource, useValue: { transaction } },
        { provide: ChannelsService, useValue: channels },
        { provide: StorageService, useValue: storage },
        { provide: VideoRecordsService, useValue: records },
        { provide: UploadSessionsService, useValue: sessions },
        {
          provide: PublicIdGenerator,
          useValue: { generate: () => 'abcdefghijkl' },
        },
      ],
    }).compile();
    service = module.get(StartVideoUploadService);
    await module.close();
  });
  it('should resolve the caller channel and create both records using one supplied manager', async () => {
    expect(await service.start('owner', input)).toEqual({
      video: { public_id: 'abcdefghijkl' },
      upload_session: { id: 'session' },
    });
    expect(channels.findOwnedByUserId).toHaveBeenCalledWith('owner');
    expect(records.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'own-channel',
        publicId: 'abcdefghijkl',
        declaredSize: 10,
      }),
      manager,
    );
    expect(sessions.create).toHaveBeenCalledWith(
      'draft',
      'private-upload',
      manager,
    );
    expect(storage.abortMultipart).not.toHaveBeenCalled();
  });
  it('should reject missing ownership before allocating storage', async () => {
    channels.findOwnedByUserId.mockRejectedValue(
      new ChannelNotFoundException(),
    );
    await expect(service.start('owner', input)).rejects.toMatchObject({
      errorCode: 'CHANNEL_NOT_FOUND',
    });
    expect(storage.createMultipart).not.toHaveBeenCalled();
  });
  it('should propagate storage allocation failure before starting persistence', async () => {
    const error = new StorageUnavailableException(new Error('offline'));
    storage.createMultipart.mockRejectedValue(error);
    await expect(service.start('owner', input)).rejects.toBe(error);
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.abortMultipart).not.toHaveBeenCalled();
  });
  it.each(['draft', 'session', 'commit'])(
    'should compensate %s failure and preserve the original error',
    async (stage) => {
      const error = new Error(`${stage} failed`);
      if (stage === 'draft') records.createDraft.mockRejectedValue(error);
      if (stage === 'session') sessions.create.mockRejectedValue(error);
      if (stage === 'commit') transaction.mockRejectedValue(error);
      await expect(service.start('owner', input)).rejects.toBe(error);
      expect(storage.abortMultipart).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(
            /^videos\/[a-f0-9-]+\/original$/,
          ) as unknown,
          uploadId: 'private-upload',
        }),
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );
  it('should preserve both failures when compensation is unavailable', async () => {
    const original = new Error('database failed');
    const compensation = new Error('abort failed');
    transaction.mockRejectedValue(original);
    storage.abortMultipart.mockRejectedValue(compensation);
    await expect(service.start('owner', input)).rejects.toMatchObject({
      errors: [original, compensation],
    });
  });
});
