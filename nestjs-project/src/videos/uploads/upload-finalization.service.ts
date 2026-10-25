import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { StorageUnavailableException } from '../../common/exceptions/storage-unavailable.exception';
import { StorageService } from '../../storage/storage.service';
import type { StoragePart } from '../../storage/storage.types';
import {
  UploadSession,
  UploadSessionStatus,
} from '../entities/upload-session.entity';
import {
  Video,
  VideoFailureReason,
  VideoStatus,
} from '../entities/video.entity';
import {
  UploadNotActiveException,
  UploadPartsInvalidException,
  UploadSizeMismatchException,
} from '../exceptions/video.exceptions';
import { VideoRecordsService } from '../video-records.service';
import { parseDeclaredSize } from '../videos.mapping';
import { UploadSessionsService } from './upload-sessions.service';

export interface CompletionPart {
  part_number: number;
  etag: string;
}
export interface FinalizationResult {
  video: Video;
  publish: boolean;
}
export interface LifecycleDecision extends FinalizationResult {
  rejection?: UploadNotActiveException | UploadSizeMismatchException;
}

@Injectable()
export class UploadFinalizationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly records: VideoRecordsService,
    private readonly sessions: UploadSessionsService,
    private readonly storage: StorageService,
  ) {}

  async complete(
    publicId: string,
    userId: string,
    manifest: readonly CompletionPart[],
  ): Promise<FinalizationResult> {
    const decision = await this.dataSource.transaction(
      async (manager): Promise<LifecycleDecision> => {
        const owned = await this.records.findOwnedByPublicId(
          publicId,
          userId,
          manager,
        );
        const session = await this.sessions.lockForVideo(owned.id, manager);
        if (!session) throw new UploadNotActiveException();
        const video = await this.current(owned.id, manager);
        if (session.status === UploadSessionStatus.COMPLETED)
          return { video, publish: false };
        if (session.status !== UploadSessionStatus.ACTIVE)
          throw new UploadNotActiveException();
        if (session.expires_at.getTime() <= Date.now())
          return await this.resolveDeadlineLocked(video, session, manager);

        const reference = {
          key: video.original_key,
          uploadId: session.upload_id,
        };
        const inventory = await this.storage.listParts(reference);
        if (inventory === null) {
          const object = await this.storage.headObject(video.original_key);
          if (!object) throw new UploadNotActiveException();
          return await this.finalizeVerifiedObject(
            video,
            session,
            object,
            manager,
            false,
          );
        }
        const verified = this.verifyManifest(
          video,
          session,
          manifest,
          inventory,
        );
        if (session.expires_at.getTime() <= Date.now())
          return await this.resolveDeadlineLocked(video, session, manager);
        let completion: 'completed' | 'missing';
        try {
          completion = await this.storage.completeMultipart(
            reference,
            verified,
          );
        } catch (error: unknown) {
          if (!(error instanceof StorageUnavailableException)) throw error;
          const object = await this.storage.headObject(video.original_key);
          if (!object) throw error;
          return await this.finalizeVerifiedObject(
            video,
            session,
            object,
            manager,
            false,
          );
        }
        const object = await this.storage.headObject(video.original_key);
        if (!object) {
          if (completion === 'missing') throw new UploadNotActiveException();
          throw new StorageUnavailableException(
            new Error('Completed object cannot yet be verified'),
          );
        }
        return await this.finalizeVerifiedObject(
          video,
          session,
          object,
          manager,
          false,
        );
      },
    );
    // Cleanup/error transitions must commit before their HTTP rejection is raised.
    if (decision.rejection) throw decision.rejection;
    return decision;
  }

  private verifyManifest(
    video: Video,
    session: UploadSession,
    manifest: readonly CompletionPart[],
    inventory: readonly StoragePart[],
  ): StoragePart[] {
    const size = parseDeclaredSize(video.declared_size);
    const total = Math.ceil(size / session.part_size);
    if (
      manifest.length !== total ||
      inventory.length !== total ||
      new Set(manifest.map((part) => part.part_number)).size !== total
    )
      throw new UploadPartsInvalidException();
    const sorted = [...inventory].sort((a, b) => a.partNumber - b.partNumber);
    for (const [index, part] of sorted.entries()) {
      const number = index + 1;
      const client = manifest.find((entry) => entry.part_number === number);
      const expectedSize =
        number === total
          ? size - session.part_size * (total - 1)
          : session.part_size;
      if (
        part.partNumber !== number ||
        !part.etag ||
        !client?.etag ||
        client.etag !== part.etag ||
        part.size !== expectedSize
      )
        throw new UploadPartsInvalidException();
    }
    return sorted;
  }

  // The caller owns the session FOR UPDATE lock and its transaction manager.
  async finalizeVerifiedObject(
    video: Video,
    session: UploadSession,
    object: { size: number },
    manager: EntityManager,
    expired: boolean,
  ): Promise<LifecycleDecision> {
    if (session.status !== UploadSessionStatus.ACTIVE)
      throw new UploadNotActiveException();
    if (object.size !== parseDeclaredSize(video.declared_size)) {
      await this.storage.deleteObject(video.original_key);
      await this.storage.abortMultipart({
        key: video.original_key,
        uploadId: session.upload_id,
      });
      await this.closeWithError(video, session, manager, expired);
      return {
        video: await this.current(video.id, manager),
        publish: false,
        rejection: new UploadSizeMismatchException(),
      };
    }
    if (
      !(await this.sessions.transitionActive(
        session.id,
        UploadSessionStatus.COMPLETED,
        manager,
      )) ||
      !(await this.records.updateState(
        video.id,
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
        {},
        manager,
      ))
    )
      throw new Error('Verified upload transition lost its active draft');
    return { video: await this.current(video.id, manager), publish: true };
  }

  async resolveDeadlineLocked(
    video: Video,
    session: UploadSession,
    manager: EntityManager,
  ): Promise<LifecycleDecision> {
    if (
      session.status !== UploadSessionStatus.ACTIVE ||
      session.expires_at.getTime() > Date.now()
    )
      throw new UploadNotActiveException();
    const object = await this.storage.headObject(video.original_key);
    if (object)
      return await this.finalizeVerifiedObject(
        video,
        session,
        object,
        manager,
        true,
      );
    await this.storage.abortMultipart({
      key: video.original_key,
      uploadId: session.upload_id,
    });
    // NoSuchUpload (or an idempotent acknowledgement) cannot rule out completion.
    const recovered = await this.storage.headObject(video.original_key);
    if (recovered)
      return await this.finalizeVerifiedObject(
        video,
        session,
        recovered,
        manager,
        true,
      );
    await this.closeWithError(video, session, manager, true);
    return {
      video: await this.current(video.id, manager),
      publish: false,
      rejection: new UploadNotActiveException(),
    };
  }

  private async closeWithError(
    video: Video,
    session: UploadSession,
    manager: EntityManager,
    expired: boolean,
  ): Promise<void> {
    if (
      !(await this.sessions.transitionActive(
        session.id,
        expired ? UploadSessionStatus.EXPIRED : UploadSessionStatus.ABORTED,
        manager,
      )) ||
      !(await this.records.updateState(
        video.id,
        VideoStatus.DRAFT,
        VideoStatus.ERROR,
        {
          failure_reason: expired
            ? VideoFailureReason.UPLOAD_EXPIRED
            : VideoFailureReason.PROCESSING_FAILED,
        },
        manager,
      ))
    )
      throw new Error('Rejected upload transition lost its active draft');
  }

  private async current(id: string, manager: EntityManager): Promise<Video> {
    const video = await this.records.findById(id, manager);
    if (!video) throw new Error('Locked upload lost its video');
    return video;
  }
}
