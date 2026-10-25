import { ApiProperty } from '@nestjs/swagger';
import { UploadedPartDto } from './uploaded-part.dto';
import { UploadSessionResponseDto } from './upload-session-response.dto';

export class ListUploadedPartsResponseDto {
  @ApiProperty({ type: UploadSessionResponseDto })
  upload_session: UploadSessionResponseDto;
  @ApiProperty({ type: [UploadedPartDto] })
  parts: UploadedPartDto[];
}
