import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import { UPLOAD_MAX_BYTES, UPLOAD_PART_SIZE_BYTES } from '../videos.constants';

const maximumParts = Math.ceil(UPLOAD_MAX_BYTES / UPLOAD_PART_SIZE_BYTES);

export class SignUploadPartsDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'integer', minimum: 1, maximum: maximumParts },
    minItems: 1,
    maxItems: maximumParts,
    uniqueItems: true,
    example: [1, 2],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(maximumParts)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(maximumParts, { each: true })
  part_numbers: number[];
}
