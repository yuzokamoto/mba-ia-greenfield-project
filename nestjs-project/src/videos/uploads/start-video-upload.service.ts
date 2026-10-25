import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ChannelsService } from '../../channels/channels.service';
import { StorageService } from '../../storage/storage.service';
import type { StartVideoUploadResponseDto } from '../dto/start-video-upload-response.dto';
import { PublicIdGenerator, reservePublicId } from '../public-id';
import { VideoRecordsService } from '../video-records.service';
import { parseDeclaredSize } from '../videos.mapping';
import { UploadSessionsService } from './upload-sessions.service';

export interface StartVideoUploadInput {
  title: string;
  original_filename: string;
  content_type: string;
  declared_size: number;
}

@Injectable()
export class StartVideoUploadService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly channels: ChannelsService,
    private readonly records: VideoRecordsService,
    private readonly sessions: UploadSessionsService,
    private readonly storage: StorageService,
    private readonly publicIds: PublicIdGenerator,
  ) {}

  async start(
    userId: string,
    input: StartVideoUploadInput,
  ): Promise<StartVideoUploadResponseDto> {
    const declaredSize = parseDeclaredSize(String(input.declared_size));
    const channel = await this.channels.findOwnedByUserId(userId);
    const id = randomUUID();
    const allocation = await this.storage.createMultipart(
      `videos/${id}/original`,
      input.content_type,
    );
    try {
      return await reservePublicId(
        async (publicId) =>
          await this.dataSource.transaction(async (manager) => {
            const video = await this.records.createDraft(
              {
                id,
                channelId: channel.id,
                publicId,
                title: input.title,
                originalFilename: input.original_filename,
                contentType: input.content_type,
                declaredSize,
              },
              manager,
            );
            const session = await this.sessions.create(
              video.id,
              allocation.uploadId,
              manager,
            );
            return {
              video: this.records.toResponse(video),
              upload_session: this.sessions.toResponse(
                session,
                video.declared_size,
              ),
            };
          }),
        () => this.publicIds.generate(),
      );
    } catch (error: unknown) {
      try {
        await this.storage.abortMultipart(allocation);
      } catch (compensationError: unknown) {
        throw new AggregateError(
          [error, compensationError],
          'Upload initiation and storage compensation failed',
        );
      }
      throw error;
    }
  }
}
