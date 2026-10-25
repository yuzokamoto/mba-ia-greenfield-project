import { ApiProperty } from '@nestjs/swagger';

export class SignedUrlResponseDto {
  @ApiProperty({ format: 'uri' }) url: string;
  @ApiProperty({ format: 'date-time' }) expires_at: string;
}
