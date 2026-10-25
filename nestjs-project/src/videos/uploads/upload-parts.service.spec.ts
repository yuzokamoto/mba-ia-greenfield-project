import { Test } from '@nestjs/testing';
import { StorageService } from '../../storage/storage.service';
import { VideoNotFoundException } from '../exceptions/video.exceptions';
import { VideoRecordsService } from '../video-records.service';
import { UploadSessionsService } from './upload-sessions.service';
import { UploadPartsService } from './upload-parts.service';

describe('UploadPartsService', () => {
  let service: UploadPartsService;
  const records = { findOwnedByPublicId: jest.fn() };
  const sessions = { findForVideo: jest.fn(), toResponse: jest.fn() };
  const storage = { listParts: jest.fn(), signPart: jest.fn() };
  let deadline: Date;
  beforeEach(async () => {
    jest.resetAllMocks();
    deadline = new Date(Date.now() + 86400000);
    records.findOwnedByPublicId.mockResolvedValue({
      id: 'video',
      original_key: 'private-key',
      declared_size: '67108865',
    });
    sessions.findForVideo.mockResolvedValue({
      status: 'active',
      expires_at: deadline,
      upload_id: 'private-upload',
    });
    sessions.toResponse.mockReturnValue({
      total_parts: 2,
      expires_at: deadline.toISOString(),
    });
    storage.listParts.mockResolvedValue([]);
    storage.signPart.mockImplementation(
      (_ref: unknown, part: number, ttl: number) =>
        Promise.resolve({
          url: `https://storage.example/part-${part}`,
          expiresAt: new Date(Date.now() + ttl * 1000),
          headers: {},
        }),
    );
    const module = await Test.createTestingModule({
      providers: [
        UploadPartsService,
        { provide: VideoRecordsService, useValue: records },
        { provide: UploadSessionsService, useValue: sessions },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(UploadPartsService);
    await module.close();
  });
  it('should authorize the owner and sign server-owned references for 900 seconds', async () => {
    const result = await service.sign('abcdefghijkl', 'owner', [2, 1]);
    expect(records.findOwnedByPublicId).toHaveBeenCalledWith(
      'abcdefghijkl',
      'owner',
    );
    expect(storage.signPart).toHaveBeenCalledWith(
      { key: 'private-key', uploadId: 'private-upload' },
      2,
      900,
    );
    expect(result.parts.map((part) => part.part_number)).toEqual([2, 1]);
    expect(Object.keys(result.parts[0]).sort()).toEqual(
      ['part_number', 'url', 'expires_at'].sort(),
    );
  });
  it('should bound renewal by the remaining session window', async () => {
    deadline.setTime(Date.now() + 90000);
    const result = await service.sign('abcdefghijkl', 'owner', [1]);
    expect(Date.parse(result.parts[0].expires_at)).toBeLessThanOrEqual(
      deadline.getTime(),
    );
    const calls = storage.signPart.mock.calls as [unknown, number, number][];
    const ttl = calls[0][2];
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(90);
  });
  it.each([[], [0], [3], [1, 1], [1.5], [NaN]])(
    'should reject invalid session-relative part numbers %j',
    async (...args) => {
      const numbers = args as number[];
      await expect(
        service.sign('abcdefghijkl', 'owner', numbers),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_PARTS_INVALID' });
      expect(storage.signPart).not.toHaveBeenCalled();
    },
  );
  it.each(['completed', 'aborted', 'expired', 'deadline', 'missing'])(
    'should reject %s sessions for signing and listing',
    async (state) => {
      if (state === 'missing') sessions.findForVideo.mockResolvedValue(null);
      else if (state === 'deadline') deadline.setTime(Date.now() - 1);
      else
        sessions.findForVideo.mockResolvedValue({
          status: state,
          expires_at: deadline,
        });
      await expect(
        service.sign('abcdefghijkl', 'owner', [1]),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
      await expect(service.list('abcdefghijkl', 'owner')).rejects.toMatchObject(
        { errorCode: 'UPLOAD_NOT_ACTIVE' },
      );
      expect(storage.listParts).not.toHaveBeenCalled();
    },
  );
  it('should deny foreign ownership before consulting session or storage', async () => {
    const error = new VideoNotFoundException();
    records.findOwnedByPublicId.mockRejectedValue(error);
    await expect(service.sign('abcdefghijkl', 'foreign', [1])).rejects.toBe(
      error,
    );
    await expect(service.list('abcdefghijkl', 'foreign')).rejects.toBe(error);
    expect(sessions.findForVideo).not.toHaveBeenCalled();
    expect(storage.listParts).not.toHaveBeenCalled();
  });
  it('should distinguish absent S3 uploads from an empty active inventory', async () => {
    expect((await service.list('abcdefghijkl', 'owner')).parts).toEqual([]);
    storage.listParts.mockResolvedValue(null);
    await expect(service.list('abcdefghijkl', 'owner')).rejects.toMatchObject({
      errorCode: 'UPLOAD_NOT_ACTIVE',
    });
    await expect(
      service.sign('abcdefghijkl', 'owner', [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
  });
  it('should report sorted actual ETags and sizes without storage authority fields', async () => {
    storage.listParts.mockResolvedValue([
      { partNumber: 2, etag: '"second"', size: 1 },
      { partNumber: 1, etag: '"first"', size: 67108864 },
    ]);
    const result = await service.list('abcdefghijkl', 'owner');
    expect(result.parts).toEqual([
      { part_number: 1, etag: '"first"', size: 67108864 },
      { part_number: 2, etag: '"second"', size: 1 },
    ]);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('should propagate unrelated storage errors unchanged', async () => {
    const error = new Error('unexpected');
    storage.listParts.mockRejectedValue(error);
    await expect(service.list('abcdefghijkl', 'owner')).rejects.toBe(error);
    await expect(service.sign('abcdefghijkl', 'owner', [1])).rejects.toBe(
      error,
    );
  });
  it('should reject renewal when less than one full signing second remains', async () => {
    deadline.setTime(Date.now() + 500);
    await expect(
      service.sign('abcdefghijkl', 'owner', [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
    expect(storage.signPart).not.toHaveBeenCalled();
  });
});
