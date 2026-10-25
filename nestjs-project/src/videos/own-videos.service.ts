import { Injectable } from '@nestjs/common';
import type { OwnVideoResponseDto } from './dto/own-video-response.dto';
import type { VideoResponseDto } from './dto/video-response.dto';
import { UploadSessionsService } from './uploads/upload-sessions.service';
import { VideoRecordsService } from './video-records.service';

@Injectable()
export class OwnVideosService {
  constructor(
    private readonly records: VideoRecordsService,
    private readonly sessions: UploadSessionsService,
  ) {}

  async detail(publicId: string, userId: string): Promise<OwnVideoResponseDto> {
    const video = await this.records.findOwnedWithSession(publicId, userId);
    if (!video.upload_session)
      throw new Error('Persisted video has no upload session');
    return {
      video: this.records.toResponse(video),
      upload_session: this.sessions.toResponse(
        video.upload_session,
        video.declared_size,
      ),
    };
  }

  async list(userId: string): Promise<VideoResponseDto[]> {
    const videos = await this.records.findAllOwned(userId);
    return videos.map((video) => this.records.toResponse(video));
  }
}
