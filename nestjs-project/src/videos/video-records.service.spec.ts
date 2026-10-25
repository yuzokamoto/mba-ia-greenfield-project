import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Video, VideoStatus } from './entities/video.entity';
import { VideoNotFoundException } from './exceptions/video.exceptions';
import { VideoRecordsService } from './video-records.service';
import { UPLOAD_MAX_BYTES } from './videos.constants';

describe('VideoRecordsService', () => {
  let service: VideoRecordsService;
  const repository = { findOne: jest.fn() };
  const fixture = (): Video =>
    Object.assign(new Video(), {
      id: 'video-id',
      channel_id: 'channel-id',
      public_id: 'abcdefghijkl',
      title: 'Video',
      status: VideoStatus.DRAFT,
      failure_reason: null,
      original_key: 'private-original',
      thumbnail_key: 'private-thumbnail',
      original_filename: 'original.mp4',
      content_type: 'video/mp4',
      declared_size: String(UPLOAD_MAX_BYTES),
      duration: null,
      metadata: null,
      processing_attempts: 2,
      created_at: new Date('2026-10-24T12:00:00Z'),
      updated_at: new Date('2026-10-24T13:00:00Z'),
      internal_diagnostics: 'private diagnostics',
    });

  beforeEach(async () => {
    repository.findOne.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        VideoRecordsService,
        {
          provide: DataSource,
          useValue: { manager: { getRepository: () => repository } },
        },
      ],
    }).compile();
    service = module.get(VideoRecordsService);
    await module.close();
  });

  it.each(['missing public ID', 'foreign owner'])(
    'should use the same not-found error for %s',
    async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(
        service.findOwnedByPublicId('abcdefghijkl', 'owner'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    },
  );

  it('should scope a successful lookup to the supplied user', async () => {
    const video = fixture();
    repository.findOne.mockResolvedValue(video);
    expect(await service.findOwnedByPublicId(video.public_id, 'owner')).toBe(
      video,
    );
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { public_id: video.public_id, channel: { user_id: 'owner' } },
    });
  });

  it('should refuse an empty identity before an ORM can omit its ownership predicate', async () => {
    await expect(
      service.findOwnedByPublicId('abcdefghijkl', ''),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('should serialize only the public projection, exact integer size and UTC dates', () => {
    const response = service.toResponse(fixture());
    expect(response.declared_size).toBe(10737418240);
    expect(response.created_at).toBe('2026-10-24T12:00:00.000Z');
    expect(response.updated_at).toBe('2026-10-24T13:00:00.000Z');
    expect(response.duration).toBeNull();
    expect(Object.keys(response).sort()).toEqual(
      [
        'id',
        'public_id',
        'channel_id',
        'title',
        'status',
        'failure_reason',
        'original_filename',
        'content_type',
        'declared_size',
        'duration',
        'metadata',
        'created_at',
        'updated_at',
      ].sort(),
    );
    expect(JSON.stringify(response)).not.toContain('private');
    expect(response).not.toHaveProperty('processing_attempts');
  });

  it.each([
    '0',
    '-1',
    String(UPLOAD_MAX_BYTES + 1),
    '9007199254740992',
    '1.5',
    'Infinity',
    '010',
  ])('should reject an unsafe persisted size %s', (declared_size) => {
    expect(() =>
      service.toResponse(Object.assign(fixture(), { declared_size })),
    ).toThrow(RangeError);
  });
});
