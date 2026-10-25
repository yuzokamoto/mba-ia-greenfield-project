import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { UPLOAD_MAX_BYTES, UPLOAD_PART_SIZE_BYTES } from '../videos.constants';

const maximumParts = Math.ceil(UPLOAD_MAX_BYTES / UPLOAD_PART_SIZE_BYTES);

export class CompleteVideoUploadPartDto {
  @IsInt()
  @Min(1)
  @Max(maximumParts)
  part_number: number;

  /** Exact ETag returned by storage, including any quotes. */
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteVideoUploadDto {
  @ApiProperty({
    type: [CompleteVideoUploadPartDto],
    minItems: 1,
    maxItems: maximumParts,
    uniqueItems: true,
    description:
      'Every expected part exactly once, unique by part_number, with its exact storage ETag.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(maximumParts)
  @ArrayUnique((part: CompleteVideoUploadPartDto | null) => part?.part_number)
  @ValidateNested({ each: true })
  @Type(() => CompleteVideoUploadPartDto)
  parts: CompleteVideoUploadPartDto[];
}
