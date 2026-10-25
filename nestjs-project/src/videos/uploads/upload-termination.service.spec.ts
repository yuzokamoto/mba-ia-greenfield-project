import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type EntityManager } from 'typeorm';
import { StorageUnavailableException } from '../../common/exceptions/storage-unavailable.exception';
import { StorageService } from '../../storage/storage.service';
import {
  UploadSession,
  UploadSessionStatus,
} from '../entities/upload-session.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import {
  UploadNotActiveException,
  VideoNotFoundException,
} from '../exceptions/video.exceptions';
import { VideoProcessingProducer } from '../queue/video-processing-producer.service';
import { VideoQueueUnavailableError } from '../queue/video-queue-unavailable.error';
import { VideoRecordsService } from '../video-records.service';
import { AbortVideoUploadService } from './abort-video-upload.service';
import { UploadFinalizationService } from './upload-finalization.service';
import { UploadSessionsService } from './upload-sessions.service';
import { UploadTerminationService } from './upload-termination.service';

describe('UploadTerminationService', () => {
  let service: UploadTerminationService;
  let video: Video;
  let session: UploadSession;
  const manager = {} as EntityManager;
  const records = {
    findOwnedByPublicId: jest.fn(),
    findById: jest.fn(),
    updateState: jest.fn(),
  };
  const sessions = { lockForVideo: jest.fn(), transitionActive: jest.fn() };
  const storage = {
    headObject: jest.fn(),
    abortMultipart: jest.fn(),
    deleteObject: jest.fn(),
    completeMultipart: jest.fn(),
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    video = Object.assign(new Video(), {
      id: 'video',
      public_id: 'abcdefghijkl',
      status: VideoStatus.DRAFT,
      declared_size: '1',
      original_key: 'known-key',
      failure_reason: null,
    });
    session = Object.assign(new UploadSession(), {
      id: 'session',
      status: UploadSessionStatus.ACTIVE,
      expires_at: new Date(Date.now() + 86400000),
      upload_id: 'known-upload',
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
    sessions.transitionActive.mockImplementation(
      (_id: string, status: UploadSessionStatus) => {
        session.status = status;
        return Promise.resolve(true);
      },
    );
    storage.headObject.mockResolvedValue(null);
    storage.abortMultipart.mockResolvedValue('aborted');
    storage.deleteObject.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        UploadTerminationService,
        UploadFinalizationService,
        {
          provide: DataSource,
          useValue: {
            transaction: async (
              work: (manager: EntityManager) => Promise<unknown>,
            ) => await work(manager),
          },
        },
        { provide: VideoRecordsService, useValue: records },
        { provide: UploadSessionsService, useValue: sessions },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(UploadTerminationService);
    await module.close();
  });
  it('should abort only the server-known upload while retaining the draft and identity', async () => {
    expect((await service.abort(video.public_id, 'owner')).publish).toBe(false);
    expect(storage.abortMultipart).toHaveBeenCalledWith({
      key: 'known-key',
      uploadId: 'known-upload',
    });
    expect(sessions.transitionActive).toHaveBeenCalledWith(
      'session',
      'aborted',
      manager,
    );
    expect(records.updateState).not.toHaveBeenCalled();
    expect(video.status).toBe('draft');
    expect(video.failure_reason).toBeNull();
  });
  it.each([UploadSessionStatus.ABORTED, UploadSessionStatus.EXPIRED])(
    'should make repeated %s abort a storage-free no-op',
    async (status) => {
      session.status = status;
      await service.abort(video.public_id, 'owner');
      expect(storage.headObject).not.toHaveBeenCalled();
      expect(sessions.transitionActive).not.toHaveBeenCalled();
    },
  );
  it('should reject completed sessions without deleting or aborting their object', async () => {
    session.status = UploadSessionStatus.COMPLETED;
    await expect(service.abort(video.public_id, 'owner')).rejects.toMatchObject(
      { errorCode: 'UPLOAD_NOT_ACTIVE' },
    );
    expect(storage.abortMultipart).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
  it('should recover a verified completed object and report completion winning abort', async () => {
    storage.headObject.mockResolvedValue({ size: 1 });
    const result = await service.abort(video.public_id, 'owner');
    expect(result.publish).toBe(true);
    expect(result.rejection).toBeInstanceOf(UploadNotActiveException);
    expect(session.status).toBe('completed');
    expect(video.status).toBe('processing');
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(storage.abortMultipart).not.toHaveBeenCalled();
  });
  it('should inspect the object after NoSuchUpload instead of assuming an abort won', async () => {
    storage.headObject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ size: 1 });
    storage.abortMultipart.mockResolvedValue('missing');
    expect((await service.abort(video.public_id, 'owner')).publish).toBe(true);
    expect(session.status).toBe('completed');
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
  it('should treat an absent upload and absent completed object as idempotent abort cleanup', async () => {
    storage.abortMultipart.mockResolvedValue('missing');
    await service.abort(video.public_id, 'owner');
    expect(session.status).toBe('aborted');
    expect(video.status).toBe('draft');
  });
  it('should recover a matching object at expiry through the same finalizer policy', async () => {
    session.expires_at = new Date(Date.now() - 1);
    storage.headObject.mockResolvedValue({ size: 1 });
    expect((await service.resolveExpired(video.id))!.publish).toBe(true);
    expect(session.status).toBe('completed');
    expect(video.status).toBe('processing');
    expect(storage.completeMultipart).not.toHaveBeenCalled();
  });
  it('should delete wrong-size completed objects and expire only with upload_expired', async () => {
    session.expires_at = new Date(Date.now() - 1);
    storage.headObject.mockResolvedValue({ size: 2 });
    expect((await service.resolveExpired(video.id))!.publish).toBe(false);
    expect(storage.deleteObject).toHaveBeenCalledWith('known-key');
    expect(session.status).toBe('expired');
    expect(video.failure_reason).toBe('upload_expired');
  });
  it('should abort incomplete storage and expire absent objects without completing bytes', async () => {
    session.expires_at = new Date(Date.now() - 1);
    storage.abortMultipart.mockResolvedValue('missing');
    await service.resolveExpired(video.id);
    expect(session.status).toBe('expired');
    expect(video.status).toBe('error');
    expect(video.failure_reason).toBe('upload_expired');
    expect(storage.completeMultipart).not.toHaveBeenCalled();
  });
  it.each(['inspection', 'abort', 'delete'])(
    'should preserve undecided expiry after transient %s failure',
    async (stage) => {
      session.expires_at = new Date(Date.now() - 1);
      const error = new StorageUnavailableException(new Error('offline'));
      if (stage === 'inspection') storage.headObject.mockRejectedValue(error);
      if (stage === 'abort') storage.abortMultipart.mockRejectedValue(error);
      if (stage === 'delete') {
        storage.headObject.mockResolvedValue({ size: 2 });
        storage.deleteObject.mockRejectedValue(error);
      }
      await expect(service.resolveExpired(video.id)).rejects.toBe(error);
      expect(session.status).toBe('active');
      expect(records.updateState).not.toHaveBeenCalled();
    },
  );
  it('should skip unexpired and previously decided sessions during worker resolution', async () => {
    expect(await service.resolveExpired(video.id)).toBeNull();
    session.status = UploadSessionStatus.COMPLETED;
    session.expires_at = new Date(Date.now() - 1);
    expect(await service.resolveExpired(video.id)).toBeNull();
    expect(storage.headObject).not.toHaveBeenCalled();
  });
  it('should authorize abort before reading another owner’s session', async () => {
    records.findOwnedByPublicId.mockRejectedValue(new VideoNotFoundException());
    await expect(
      service.abort(video.public_id, 'foreign'),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    expect(sessions.lockForVideo).not.toHaveBeenCalled();
  });
});

describe('AbortVideoUploadService', () => {
  const termination = { abort: jest.fn() };
  const publisher = { enqueue: jest.fn() };
  let service: AbortVideoUploadService;
  beforeEach(async () => {
    jest.resetAllMocks();
    publisher.enqueue.mockResolvedValue({});
    const module = await Test.createTestingModule({
      providers: [
        AbortVideoUploadService,
        { provide: UploadTerminationService, useValue: termination },
        { provide: VideoProcessingProducer, useValue: publisher },
      ],
    }).compile();
    service = module.get(AbortVideoUploadService);
    await module.close();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it('should avoid queue publication for an ordinary abort', async () => {
    termination.abort.mockResolvedValue({
      video: { id: 'video' },
      publish: false,
    });
    await service.abort('abcdefghijkl', 'owner');
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });
  it('should publish recovered intent after commit and preserve 409 when Redis is unavailable', async () => {
    termination.abort.mockImplementation(() => {
      expect(publisher.enqueue).not.toHaveBeenCalled();
      return Promise.resolve({
        video: { id: 'video' },
        publish: true,
        rejection: new UploadNotActiveException(),
      });
    });
    publisher.enqueue.mockRejectedValue(
      new VideoQueueUnavailableError(new Error('private Redis diagnostics')),
    );
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await expect(service.abort('abcdefghijkl', 'owner')).rejects.toMatchObject({
      errorCode: 'UPLOAD_NOT_ACTIVE',
    });
    expect(warn.mock.calls).toEqual([
      ['Video processing publication deferred'],
    ]);
    expect(publisher.enqueue).toHaveBeenCalledWith('video');
  });
  it('should propagate unexpected publication failures', async () => {
    const error = new Error('unexpected');
    termination.abort.mockResolvedValue({
      video: { id: 'video' },
      publish: true,
      rejection: new UploadNotActiveException(),
    });
    publisher.enqueue.mockRejectedValue(error);
    await expect(service.abort('abcdefghijkl', 'owner')).rejects.toBe(error);
  });
});
