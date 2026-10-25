import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { UploadSessionStatus } from '../entities/upload-session.entity';
import { VideoStatus } from '../entities/video.entity';
import { UploadNotActiveException } from '../exceptions/video.exceptions';
import { VideoRecordsService } from '../video-records.service';
import { parseDeclaredSize } from '../videos.mapping';
import {
  UploadFinalizationService,
  type FinalizationResult,
} from './upload-finalization.service';
import { UploadSessionsService } from './upload-sessions.service';

export interface TerminationResult extends FinalizationResult {
  rejection?: UploadNotActiveException;
}

@Injectable()
export class UploadTerminationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly records: VideoRecordsService,
    private readonly sessions: UploadSessionsService,
    private readonly storage: StorageService,
    private readonly finalizer: UploadFinalizationService,
  ) {}

  async abort(publicId: string, userId: string): Promise<TerminationResult> {
    return await this.dataSource.transaction(async (manager) => {
      const owned = await this.records.findOwnedByPublicId(
        publicId,
        userId,
        manager,
      );
      const session = await this.sessions.lockForVideo(owned.id, manager);
      if (!session) throw new UploadNotActiveException();
      const video = await this.records.findById(owned.id, manager);
      if (!video) throw new Error('Locked upload lost its video');
      if (session.status === UploadSessionStatus.COMPLETED)
        throw new UploadNotActiveException();
      if (session.status !== UploadSessionStatus.ACTIVE)
        return { video, publish: false };
      if (session.expires_at.getTime() <= Date.now()) {
        const result = await this.finalizer.resolveDeadlineLocked(
          video,
          session,
          manager,
        );
        return {
          video: result.video,
          publish: result.publish,
          ...(result.publish
            ? { rejection: new UploadNotActiveException() }
            : {}),
        };
      }
      const reference = {
        key: video.original_key,
        uploadId: session.upload_id,
      };
      const object = await this.storage.headObject(video.original_key);
      if (object?.size === parseDeclaredSize(video.declared_size)) {
        const result = await this.finalizer.finalizeVerifiedObject(
          video,
          session,
          object,
          manager,
          false,
        );
        return { ...result, rejection: new UploadNotActiveException() };
      }
      if (object) await this.storage.deleteObject(video.original_key);
      await this.storage.abortMultipart(reference);
      // Always check again: pinned MinIO may acknowledge an already closed upload.
      const recovered = await this.storage.headObject(video.original_key);
      if (recovered?.size === parseDeclaredSize(video.declared_size)) {
        const result = await this.finalizer.finalizeVerifiedObject(
          video,
          session,
          recovered,
          manager,
          false,
        );
        return { ...result, rejection: new UploadNotActiveException() };
      }
      if (recovered) await this.storage.deleteObject(video.original_key);
      if (
        video.status !== VideoStatus.DRAFT ||
        !(await this.sessions.transitionActive(
          session.id,
          UploadSessionStatus.ABORTED,
          manager,
        ))
      )
        throw new Error('Voluntary abort lost its active draft');
      return { video, publish: false };
    });
  }

  async resolveExpired(videoId: string): Promise<FinalizationResult | null> {
    return await this.dataSource.transaction(async (manager) => {
      const found = await this.records.findById(videoId, manager);
      if (!found) return null;
      const session = await this.sessions.lockForVideo(found.id, manager);
      if (
        !session ||
        session.status !== UploadSessionStatus.ACTIVE ||
        session.expires_at.getTime() > Date.now()
      )
        return null;
      const video = await this.records.findById(found.id, manager);
      if (!video) throw new Error('Locked upload lost its video');
      const result = await this.finalizer.resolveDeadlineLocked(
        video,
        session,
        manager,
      );
      return { video: result.video, publish: result.publish };
    });
  }
}
