import { ApiProperty } from '@nestjs/swagger';
import { UploadSessionResponseDto } from './upload-session-response.dto';
import { VideoResponseDto } from './video-response.dto';

export class OwnVideoResponseDto {
  @ApiProperty({ type: VideoResponseDto }) video: VideoResponseDto;
  @ApiProperty({ type: UploadSessionResponseDto })
  upload_session: UploadSessionResponseDto;
}
