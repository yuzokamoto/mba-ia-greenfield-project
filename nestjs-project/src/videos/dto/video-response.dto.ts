import { ApiProperty } from '@nestjs/swagger';
import { VideoFailureReason, VideoStatus } from '../entities/video.entity';
import { UPLOAD_MAX_BYTES } from '../videos.constants';

export class VideoResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ minLength: 12, maxLength: 12, pattern: '^[A-Za-z0-9_-]{12}$' })
  public_id: string;
  @ApiProperty({ format: 'uuid' }) channel_id: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: VideoStatus }) status: VideoStatus;
  @ApiProperty({ enum: VideoFailureReason, nullable: true, required: true })
  failure_reason: VideoFailureReason | null;
  @ApiProperty() original_filename: string;
  @ApiProperty() content_type: string;
  @ApiProperty({
    type: 'integer',
    format: 'int64',
    minimum: 1,
    maximum: UPLOAD_MAX_BYTES,
  })
  declared_size: number;
  @ApiProperty({ type: Number, nullable: true, required: true }) duration:
    | number
    | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  metadata: Record<string, unknown> | null;
  @ApiProperty({ format: 'date-time' }) created_at: string;
  @ApiProperty({ format: 'date-time' }) updated_at: string;
}
