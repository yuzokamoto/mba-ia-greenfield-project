import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { VideoResponseDto } from './dto/video-response.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { VideoNotFoundException } from './exceptions/video.exceptions';
import { parseDeclaredSize } from './videos.mapping';

export interface CreateVideoRecord {
  id: string;
  channelId: string;
  publicId: string;
  title: string;
  originalFilename: string;
  contentType: string;
  declaredSize: number;
}

type ProcessingFields = Partial<
  Pick<Video, 'failure_reason' | 'duration' | 'metadata' | 'thumbnail_key'>
>;

@Injectable()
export class VideoRecordsService {
  constructor(private readonly dataSource: DataSource) {}

  async findOwnedByPublicId(
    publicId: string,
    userId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Video> {
    if (!publicId || !userId) throw new VideoNotFoundException();
    const video = await manager.getRepository(Video).findOne({
      where: { public_id: publicId, channel: { user_id: userId } },
    });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  async findById(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Video | null> {
    if (!id) return null;
    return await manager.getRepository(Video).findOneBy({ id });
  }

  async findOwnedWithSession(publicId: string, userId: string): Promise<Video> {
    if (!publicId || !userId) throw new VideoNotFoundException();
    const video = await this.dataSource.getRepository(Video).findOne({
      where: { public_id: publicId, channel: { user_id: userId } },
      relations: { upload_session: true },
      relationLoadStrategy: 'join',
    });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  async findAllOwned(userId: string): Promise<Video[]> {
    if (!userId) return [];
    return await this.dataSource.getRepository(Video).find({
      where: { channel: { user_id: userId } },
      order: { created_at: 'DESC', id: 'DESC' },
    });
  }

  async createDraft(
    input: CreateVideoRecord,
    manager: EntityManager,
  ): Promise<Video> {
    const declaredSize = parseDeclaredSize(String(input.declaredSize));
    const repository = manager.getRepository(Video);
    return await repository.save(
      repository.create({
        id: input.id,
        channel_id: input.channelId,
        public_id: input.publicId,
        title: input.title,
        original_filename: input.originalFilename,
        content_type: input.contentType,
        declared_size: String(declaredSize),
        original_key: `videos/${input.id}/original`,
        status: VideoStatus.DRAFT,
      }),
    );
  }

  async updateState(
    id: string,
    expectedStatus: VideoStatus,
    status: VideoStatus,
    fields: ProcessingFields = {},
    manager: EntityManager = this.dataSource.manager,
  ): Promise<boolean> {
    const { metadata, ...columns } = fields;
    const query = manager
      .getRepository(Video)
      .createQueryBuilder()
      .update(Video)
      .set({
        ...columns,
        status,
        ...(metadata !== undefined ? { metadata: () => ':videoMetadata' } : {}),
      })
      .where('id = :id AND status = :expectedStatus', { id, expectedStatus });
    // Bind the JSON object as one SQL value rather than TypeORM's recursive
    // QueryDeepPartialEntity<unknown> representation of arbitrary JSON keys.
    if (metadata !== undefined) query.setParameter('videoMetadata', metadata);
    const result = await query.execute();
    return result.affected === 1;
  }

  async reserveProcessingAttempt(id: string): Promise<number | null> {
    const result = await this.dataSource
      .getRepository(Video)
      .createQueryBuilder()
      .update(Video)
      .set({ processing_attempts: () => '"processing_attempts" + 1' })
      .where(
        'id = :id AND status = :status AND processing_attempts < :maximum',
        { id, status: VideoStatus.PROCESSING, maximum: 3 },
      )
      .returning('processing_attempts')
      .execute();
    const rows = result.raw as { processing_attempts: number }[];
    return rows[0]?.processing_attempts ?? null;
  }

  async findProcessing(): Promise<Pick<Video, 'id'>[]> {
    return await this.dataSource.getRepository(Video).find({
      select: { id: true },
      where: { status: VideoStatus.PROCESSING },
    });
  }

  toResponse(video: Video): VideoResponseDto {
    return {
      id: video.id,
      public_id: video.public_id,
      channel_id: video.channel_id,
      title: video.title,
      status: video.status,
      failure_reason: video.failure_reason,
      original_filename: video.original_filename,
      content_type: video.content_type,
      declared_size: parseDeclaredSize(video.declared_size),
      duration: video.duration,
      metadata: video.metadata,
      created_at: video.created_at.toISOString(),
      updated_at: video.updated_at.toISOString(),
    };
  }
}
