import { Test } from '@nestjs/testing';
import { DataSource, type EntityManager } from 'typeorm';
import { StorageUnavailableException } from '../../common/exceptions/storage-unavailable.exception';
import { StorageService } from '../../storage/storage.service';
import {
  UploadSession,
  UploadSessionStatus,
} from '../entities/upload-session.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideoNotFoundException } from '../exceptions/video.exceptions';
import { VideoRecordsService } from '../video-records.service';
import { UploadFinalizationService } from './upload-finalization.service';
import { UploadSessionsService } from './upload-sessions.service';

describe('UploadFinalizationService', () => {
  let service: UploadFinalizationService;
  let video: Video;
  let session: UploadSession;
  let committed: boolean;
  const manager = {} as EntityManager;
  const records = {
    findOwnedByPublicId: jest.fn(),
    findById: jest.fn(),
    updateState: jest.fn(),
  };
  const sessions = { lockForVideo: jest.fn(), transitionActive: jest.fn() };
  const storage = {
    listParts: jest.fn(),
    completeMultipart: jest.fn(),
    headObject: jest.fn(),
    abortMultipart: jest.fn(),
    deleteObject: jest.fn(),
  };
  const manifest = [{ part_number: 1, etag: '"one"' }];
  beforeEach(async () => {
    jest.resetAllMocks();
    committed = false;
    video = Object.assign(new Video(), {
      id: 'video',
      public_id: 'abcdefghijkl',
      status: VideoStatus.DRAFT,
      original_key: 'private-key',
      declared_size: '1',
    });
    session = Object.assign(new UploadSession(), {
      id: 'session',
      status: UploadSessionStatus.ACTIVE,
      expires_at: new Date(Date.now() + 86400000),
      part_size: 67108864,
      upload_id: 'private-upload',
    });
    records.findOwnedByPublicId.mockResolvedValue(video);
    records.findById.mockResolvedValue(video);
    records.updateState.mockImplementation(
      (
        _id: string,
        _expected: VideoStatus,
        status: VideoStatus,
        fields: Partial<Video>,
      ) => {
        Object.assign(video, fields, { status });
        return Promise.resolve(true);
      },
    );
    sessions.lockForVideo.mockResolvedValue(session);
    sessions.transitionActive.mockResolvedValue(true);
    storage.listParts.mockResolvedValue([
      { partNumber: 1, etag: '"one"', size: 1 },
    ]);
    storage.completeMultipart.mockResolvedValue('completed');
    storage.headObject.mockResolvedValue({ size: 1 });
    storage.abortMultipart.mockResolvedValue('aborted');
    storage.deleteObject.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        UploadFinalizationService,
        {
          provide: DataSource,
          useValue: {
            transaction: async (
              work: (manager: EntityManager) => Promise<unknown>,
            ) => {
              const result = await work(manager);
              committed = true;
              return result;
            },
          },
        },
        { provide: VideoRecordsService, useValue: records },
        { provide: UploadSessionsService, useValue: sessions },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(UploadFinalizationService);
    await module.close();
  });
  it('should verify inventory and atomically transition using the locked manager', async () => {
    expect(
      (await service.complete(video.public_id, 'owner', manifest)).publish,
    ).toBe(true);
    expect(records.findOwnedByPublicId).toHaveBeenCalledWith(
      video.public_id,
      'owner',
      manager,
    );
    expect(sessions.lockForVideo).toHaveBeenCalledWith(video.id, manager);
    expect(storage.completeMultipart).toHaveBeenCalledWith(
      { key: 'private-key', uploadId: 'private-upload' },
      [{ partNumber: 1, etag: '"one"', size: 1 }],
    );
    expect(sessions.transitionActive).toHaveBeenCalledWith(
      'session',
      'completed',
      manager,
    );
    expect(records.updateState).toHaveBeenCalledWith(
      'video',
      'draft',
      'processing',
      {},
      manager,
    );
    expect(committed).toBe(true);
  });
  it.each([
    [],
    [{ part_number: 2, etag: '"one"' }],
    [{ part_number: 1, etag: 'wrong' }],
    [{ part_number: 1, etag: '' }],
    [
      { part_number: 1, etag: '"one"' },
      { part_number: 1, etag: '"one"' },
    ],
  ])('should reject a mismatching client manifest %j', async (...entries) => {
    await expect(
      service.complete(video.public_id, 'owner', entries as typeof manifest),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_PARTS_INVALID' });
    expect(storage.completeMultipart).not.toHaveBeenCalled();
    expect(committed).toBe(false);
  });
  it.each([
    [],
    [{ partNumber: 2, etag: '"one"', size: 1 }],
    [{ partNumber: 1, etag: '"one"', size: 2 }],
  ])(
    'should reject incomplete or wrong-size storage inventories %j',
    async (...parts) => {
      storage.listParts.mockResolvedValue(parts);
      await expect(
        service.complete(video.public_id, 'owner', manifest),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_PARTS_INVALID' });
      expect(storage.completeMultipart).not.toHaveBeenCalled();
    },
  );
  it('should deny another owner before locking or consulting storage', async () => {
    records.findOwnedByPublicId.mockRejectedValue(new VideoNotFoundException());
    await expect(
      service.complete(video.public_id, 'foreign', manifest),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    expect(sessions.lockForVideo).not.toHaveBeenCalled();
    expect(storage.listParts).not.toHaveBeenCalled();
  });
  it.each([UploadSessionStatus.ABORTED, UploadSessionStatus.EXPIRED])(
    'should reject %s sessions',
    async (status) => {
      session.status = status;
      await expect(
        service.complete(video.public_id, 'owner', manifest),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
      expect(storage.completeMultipart).not.toHaveBeenCalled();
    },
  );
  it.each([VideoStatus.PROCESSING, VideoStatus.READY, VideoStatus.ERROR])(
    'should return the current %s video for an already completed session without new work',
    async (status) => {
      session.status = UploadSessionStatus.COMPLETED;
      video.status = status;
      expect(
        await service.complete(video.public_id, 'owner', manifest),
      ).toEqual({ video, publish: false });
      expect(storage.listParts).not.toHaveBeenCalled();
      expect(records.updateState).not.toHaveBeenCalled();
    },
  );
  it('should recover a known completed object when ListParts returns NoSuchUpload', async () => {
    storage.listParts.mockResolvedValue(null);
    expect(
      (await service.complete(video.public_id, 'owner', manifest)).publish,
    ).toBe(true);
    expect(storage.completeMultipart).not.toHaveBeenCalled();
  });
  it('should distinguish absent uploads/objects from unavailable inventory', async () => {
    storage.listParts.mockResolvedValue(null);
    storage.headObject.mockResolvedValue(null);
    await expect(
      service.complete(video.public_id, 'owner', manifest),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
    const error = new StorageUnavailableException(new Error('offline'));
    storage.listParts.mockRejectedValue(error);
    await expect(
      service.complete(video.public_id, 'owner', manifest),
    ).rejects.toBe(error);
    expect(sessions.transitionActive).not.toHaveBeenCalled();
  });
  it('should recover a lost CompleteMultipartUpload response only after verifying HeadObject', async () => {
    const error = new StorageUnavailableException(new Error('lost response'));
    storage.completeMultipart.mockRejectedValue(error);
    expect(
      (await service.complete(video.public_id, 'owner', manifest)).publish,
    ).toBe(true);
    storage.headObject.mockResolvedValue(null);
    await expect(
      service.complete(video.public_id, 'owner', manifest),
    ).rejects.toBe(error);
  });
  it('should propagate unexpected errors without pretending they are transient', async () => {
    const error = new Error('programming failure');
    storage.completeMultipart.mockRejectedValue(error);
    await expect(
      service.complete(video.public_id, 'owner', manifest),
    ).rejects.toBe(error);
    expect(storage.headObject).not.toHaveBeenCalled();
  });
  it('should commit cleanup and a safe error before raising the size-mismatch rejection', async () => {
    storage.headObject.mockResolvedValue({ size: 2 });
    await expect(
      service.complete(video.public_id, 'owner', manifest),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_SIZE_MISMATCH' });
    expect(storage.deleteObject).toHaveBeenCalledWith('private-key');
    expect(storage.abortMultipart).toHaveBeenCalled();
    expect(records.updateState).toHaveBeenCalledWith(
      'video',
      'draft',
      'error',
      { failure_reason: 'processing_failed' },
      manager,
    );
    expect(committed).toBe(true);
  });
  it('should preserve an undecided session when required cleanup fails', async () => {
    const error = new StorageUnavailableException(
      new Error('delete unavailable'),
    );
    storage.headObject.mockResolvedValue({ size: 2 });
    storage.deleteObject.mockRejectedValue(error);
    await expect(
      service.complete(video.public_id, 'owner', manifest),
    ).rejects.toBe(error);
    expect(sessions.transitionActive).not.toHaveBeenCalled();
    expect(committed).toBe(false);
  });
  it('should resolve an elapsed session from HeadObject without completing unfinished parts', async () => {
    session.expires_at = new Date(Date.now() - 1);
    storage.headObject.mockResolvedValue(null);
    await expect(
      service.complete(video.public_id, 'owner', manifest),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
    expect(storage.completeMultipart).not.toHaveBeenCalled();
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(records.updateState).toHaveBeenCalledWith(
      'video',
      'draft',
      'error',
      { failure_reason: 'upload_expired' },
      manager,
    );
    expect(committed).toBe(true);
  });
});
