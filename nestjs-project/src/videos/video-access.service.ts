import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import type { SignedUrlResponseDto } from './dto/signed-url-response.dto';
import { VideoStatus } from './entities/video.entity';
import { VideoNotReadyException } from './exceptions/video.exceptions';
import { VideoRecordsService } from './video-records.service';

@Injectable()
export class VideoAccessService {
  constructor(
    private readonly records: VideoRecordsService,
    private readonly storage: StorageService,
  ) {}

  async playback(
    publicId: string,
    userId: string,
  ): Promise<SignedUrlResponseDto> {
    return await this.issue(publicId, userId, 'inline');
  }

  async download(
    publicId: string,
    userId: string,
  ): Promise<SignedUrlResponseDto> {
    return await this.issue(publicId, userId, 'attachment');
  }

  private async issue(
    publicId: string,
    userId: string,
    disposition: 'inline' | 'attachment',
  ): Promise<SignedUrlResponseDto> {
    const video = await this.records.findOwnedByPublicId(publicId, userId);
    if (video.status !== VideoStatus.READY) throw new VideoNotReadyException();
    const leaf = video.original_filename.split(/[\\/]/).at(-1) ?? '';
    const filename = Array.from(leaf)
      .filter((character) => {
        const code = character.codePointAt(0)!;
        return code >= 32 && (code < 127 || code > 159);
      })
      .join('')
      .trim();
    const safeFilename =
      !filename || filename === '.' || filename === '..' ? 'video' : filename;
    const signed = await this.storage.signPublicGet(
      video.original_key,
      safeFilename,
      disposition,
    );
    return { url: signed.url, expires_at: signed.expiresAt.toISOString() };
  }
}
