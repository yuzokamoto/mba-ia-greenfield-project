import { Injectable } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import type { ListUploadedPartsResponseDto } from '../dto/list-uploaded-parts-response.dto';
import type { SignUploadPartsResponseDto } from '../dto/sign-upload-parts-response.dto';
import { UploadSessionStatus } from '../entities/upload-session.entity';
import {
  UploadNotActiveException,
  UploadPartsInvalidException,
} from '../exceptions/video.exceptions';
import { VideoRecordsService } from '../video-records.service';
import { UPLOAD_PART_URL_TTL_SECONDS } from '../videos.constants';
import { UploadSessionsService } from './upload-sessions.service';

@Injectable()
export class UploadPartsService {
  constructor(
    private readonly records: VideoRecordsService,
    private readonly sessions: UploadSessionsService,
    private readonly storage: StorageService,
  ) {}

  private async active(publicId: string, userId: string) {
    const video = await this.records.findOwnedByPublicId(publicId, userId);
    const session = await this.sessions.findForVideo(video.id);
    if (
      !session ||
      session.status !== UploadSessionStatus.ACTIVE ||
      session.expires_at.getTime() <= Date.now()
    )
      throw new UploadNotActiveException();
    return {
      video,
      session,
      response: this.sessions.toResponse(session, video.declared_size),
    };
  }

  async sign(
    publicId: string,
    userId: string,
    partNumbers: readonly number[],
  ): Promise<SignUploadPartsResponseDto> {
    const { video, session, response } = await this.active(publicId, userId);
    if (
      partNumbers.length === 0 ||
      partNumbers.length > response.total_parts ||
      new Set(partNumbers).size !== partNumbers.length ||
      partNumbers.some(
        (number) =>
          !Number.isInteger(number) ||
          number < 1 ||
          number > response.total_parts,
      )
    )
      throw new UploadPartsInvalidException();
    const reference = { key: video.original_key, uploadId: session.upload_id };
    if ((await this.storage.listParts(reference)) === null)
      throw new UploadNotActiveException();
    const parts: SignUploadPartsResponseDto['parts'] = [];
    for (const partNumber of partNumbers) {
      const ttl = Math.min(
        UPLOAD_PART_URL_TTL_SECONDS,
        Math.floor((session.expires_at.getTime() - Date.now()) / 1000),
      );
      if (ttl < 1) throw new UploadNotActiveException();
      const signed = await this.storage.signPart(reference, partNumber, ttl);
      if (signed.expiresAt.getTime() > session.expires_at.getTime())
        throw new UploadNotActiveException();
      parts.push({
        part_number: partNumber,
        url: signed.url,
        expires_at: signed.expiresAt.toISOString(),
      });
    }
    return { parts };
  }

  async list(
    publicId: string,
    userId: string,
  ): Promise<ListUploadedPartsResponseDto> {
    const { video, session, response } = await this.active(publicId, userId);
    const parts = await this.storage.listParts({
      key: video.original_key,
      uploadId: session.upload_id,
    });
    if (parts === null || session.expires_at.getTime() <= Date.now())
      throw new UploadNotActiveException();
    return {
      upload_session: response,
      parts: [...parts]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((part) => ({
          part_number: part.partNumber,
          etag: part.etag,
          size: part.size,
        })),
    };
  }
}
