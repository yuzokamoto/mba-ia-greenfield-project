import { ApiProperty } from '@nestjs/swagger';

export class SignedUploadPartDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 160 })
  part_number: number;
  @ApiProperty({
    format: 'uri',
    description:
      'Direct storage PUT URL; no additional signed headers are required.',
  })
  url: string;
  @ApiProperty({ format: 'date-time' })
  expires_at: string;
}

export class SignUploadPartsResponseDto {
  @ApiProperty({ type: [SignedUploadPartDto] })
  parts: SignedUploadPartDto[];
}
