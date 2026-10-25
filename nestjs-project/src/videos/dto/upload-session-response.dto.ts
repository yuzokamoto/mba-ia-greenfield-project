import { ApiProperty } from '@nestjs/swagger';
import { UploadSessionStatus } from '../entities/upload-session.entity';

export class UploadSessionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: UploadSessionStatus }) status: UploadSessionStatus;
  @ApiProperty({ type: 'integer', minimum: 1 }) part_size: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) total_parts: number;
  @ApiProperty({ format: 'date-time' }) expires_at: string;
}
