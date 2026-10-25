import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { UploadSessionResponseDto } from '../dto/upload-session-response.dto';
import {
  UploadSession,
  UploadSessionStatus,
} from '../entities/upload-session.entity';
import { UploadNotActiveException } from '../exceptions/video.exceptions';
import {
  UPLOAD_PART_SIZE_BYTES,
  UPLOAD_SESSION_TTL_SECONDS,
} from '../videos.constants';
import { parseDeclaredSize } from '../videos.mapping';

@Injectable()
export class UploadSessionsService {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    videoId: string,
    uploadId: string,
    manager: EntityManager,
  ): Promise<UploadSession> {
    const repository = manager.getRepository(UploadSession);
    return await repository.save(
      repository.create({
        video_id: videoId,
        upload_id: uploadId,
        status: UploadSessionStatus.ACTIVE,
        part_size: UPLOAD_PART_SIZE_BYTES,
        expires_at: new Date(Date.now() + UPLOAD_SESSION_TTL_SECONDS * 1000),
      }),
    );
  }

  async findForVideo(
    videoId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<UploadSession | null> {
    return await manager
      .getRepository(UploadSession)
      .findOneBy({ video_id: videoId });
  }

  async lockForVideo(
    videoId: string,
    manager: EntityManager,
  ): Promise<UploadSession | null> {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error('Upload row locks require an active transaction manager');
    return await manager.getRepository(UploadSession).findOne({
      where: { video_id: videoId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async lockActiveForVideo(
    videoId: string,
    manager: EntityManager,
  ): Promise<UploadSession> {
    const session = await this.lockForVideo(videoId, manager);
    if (!session || session.status !== UploadSessionStatus.ACTIVE)
      throw new UploadNotActiveException();
    return session;
  }

  async transitionActive(
    id: string,
    status: Exclude<UploadSessionStatus, UploadSessionStatus.ACTIVE>,
    manager: EntityManager,
  ): Promise<boolean> {
    const result = await manager
      .getRepository(UploadSession)
      .update({ id, status: UploadSessionStatus.ACTIVE }, { status });
    return result.affected === 1;
  }

  toResponse(
    session: UploadSession,
    declaredSize: string,
  ): UploadSessionResponseDto {
    if (!Number.isInteger(session.part_size) || session.part_size <= 0)
      throw new RangeError('Persisted part size must be positive');
    return {
      id: session.id,
      status: session.status,
      part_size: session.part_size,
      total_parts: Math.ceil(
        parseDeclaredSize(declaredSize) / session.part_size,
      ),
      expires_at: session.expires_at.toISOString(),
    };
  }
}
