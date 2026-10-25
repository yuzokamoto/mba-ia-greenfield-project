import { ApiProperty } from '@nestjs/swagger';

export class UploadedPartDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 160 })
  part_number: number;
  @ApiProperty({
    description: 'Exact storage ETag, preserved for upload completion.',
  })
  etag: string;
  @ApiProperty({ type: 'integer', format: 'int64', minimum: 0 })
  size: number;
}
