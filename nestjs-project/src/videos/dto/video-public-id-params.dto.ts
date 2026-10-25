import { IsString, Matches } from 'class-validator';

export class VideoPublicIdParamsDto {
  /** Immutable 12-character base64url video identifier. */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{12}$/)
  publicId: string;
}
