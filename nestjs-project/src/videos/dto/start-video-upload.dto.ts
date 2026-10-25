import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import { UPLOAD_MAX_BYTES } from '../videos.constants';

export class StartVideoUploadDto {
  /** Display title for the draft video. */
  @ApiProperty({ minLength: 1, example: 'My video' })
  @IsString()
  @IsNotEmpty()
  title: string;

  /** Original client filename; it never selects a storage key. */
  @ApiProperty({ minLength: 1, example: 'example.mp4' })
  @IsString()
  @IsNotEmpty()
  original_filename: string;

  /** Declared MIME metadata; actual media is inspected after upload. */
  @ApiProperty({ minLength: 1, example: 'video/mp4' })
  @IsString()
  @IsNotEmpty()
  content_type: string;

  @ApiProperty({
    type: 'integer',
    format: 'int64',
    minimum: 1,
    maximum: UPLOAD_MAX_BYTES,
    description: 'Source size in bytes, at most 10 GiB (10737418240 bytes).',
  })
  @IsInt()
  @Min(1)
  @Max(UPLOAD_MAX_BYTES)
  declared_size: number;
}
