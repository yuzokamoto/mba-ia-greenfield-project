import { Test, type TestingModule } from '@nestjs/testing';
import { StorageUnavailableException } from '../common/exceptions/storage-unavailable.exception';
import { StorageService } from '../storage/storage.service';
import { VideoNotFoundException } from './exceptions/video.exceptions';
import { VideoAccessService } from './video-access.service';
import { VideoRecordsService } from './video-records.service';

describe('VideoAccessService', () => {
  const records = { findOwnedByPublicId: jest.fn() };
  const storage = { signPublicGet: jest.fn() };
  let module: TestingModule;
  let service: VideoAccessService;
  beforeEach(async () => {
    jest.resetAllMocks();
    records.findOwnedByPublicId.mockResolvedValue({
      status: 'ready',
      original_key: 'server-original',
      original_filename: 'source.mp4',
    });
    storage.signPublicGet.mockResolvedValue({
      url: 'https://storage.example/signed',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      headers: {},
    });
    module = await Test.createTestingModule({
      providers: [
        VideoAccessService,
        { provide: VideoRecordsService, useValue: records },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(VideoAccessService);
  });
  afterEach(async () => {
    await module.close();
  });
  it.each([
    ['playback', 'inline'],
    ['download', 'attachment'],
  ] as const)(
    'should authorize %s and select the signer mode that owns its configured TTL',
    async (operation, disposition) => {
      expect(await service[operation]('public', 'user')).toEqual({
        url: 'https://storage.example/signed',
        expires_at: '2030-01-01T00:00:00.000Z',
      });
      expect(records.findOwnedByPublicId).toHaveBeenCalledWith(
        'public',
        'user',
      );
      expect(storage.signPublicGet).toHaveBeenCalledWith(
        'server-original',
        'source.mp4',
        disposition,
      );
    },
  );
  it.each(['draft', 'processing', 'error'])(
    'should reject %s before either signer is called',
    async (status) => {
      records.findOwnedByPublicId.mockResolvedValue({ status });
      for (const operation of ['playback', 'download'] as const)
        await expect(
          service[operation]('public', 'user'),
        ).rejects.toMatchObject({
          errorCode: 'VIDEO_NOT_READY',
          httpStatus: 409,
        });
      expect(storage.signPublicGet).not.toHaveBeenCalled();
    },
  );
  it('should preserve owner-scoped absence before readiness or storage authority', async () => {
    records.findOwnedByPublicId.mockRejectedValue(new VideoNotFoundException());
    for (const operation of ['playback', 'download'] as const)
      await expect(service[operation]('foreign', 'user')).rejects.toMatchObject(
        { errorCode: 'VIDEO_NOT_FOUND' },
      );
    expect(storage.signPublicGet).not.toHaveBeenCalled();
  });
  it.each([
    [
      'C:\\folder\\../vidéo "clip"\r\n\u0000\u007f\u0085.mp4',
      'vidéo "clip".mp4',
    ],
    ['/directory/source.mp4', 'source.mp4'],
    ['../../', 'video'],
    ['..', 'video'],
    ['.', 'video'],
    ['\u0000\r\n', 'video'],
  ])(
    'should strip path/control authority from filename %j',
    async (original_filename, filename) => {
      records.findOwnedByPublicId.mockResolvedValue({
        status: 'ready',
        original_key: 'known-key',
        original_filename,
      });
      await service.download('public', 'user');
      expect(storage.signPublicGet).toHaveBeenCalledWith(
        'known-key',
        filename,
        'attachment',
      );
    },
  );
  it('should preserve storage unavailability without fabricating a URL', async () => {
    const error = new StorageUnavailableException(new Error('private cause'));
    storage.signPublicGet.mockRejectedValue(error);
    await expect(service.playback('public', 'user')).rejects.toBe(error);
  });
});
