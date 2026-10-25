import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { StartVideoUploadDto } from './dto/start-video-upload.dto';
import { StartVideoUploadResponseDto } from './dto/start-video-upload-response.dto';
import { StartVideoUploadService } from './uploads/start-video-upload.service';
import { SignUploadPartsDto } from './dto/sign-upload-parts.dto';
import { SignUploadPartsResponseDto } from './dto/sign-upload-parts-response.dto';
import { VideoPublicIdParamsDto } from './dto/video-public-id-params.dto';
import { UploadPartsService } from './uploads/upload-parts.service';
import { ListUploadedPartsResponseDto } from './dto/list-uploaded-parts-response.dto';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { CompleteVideoUploadService } from './uploads/complete-video-upload.service';
import { AbortVideoUploadService } from './uploads/abort-video-upload.service';
import { OwnVideosService } from './own-videos.service';
import { OwnVideoResponseDto } from './dto/own-video-response.dto';
import { VideoAccessService } from './video-access.service';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly startUpload: StartVideoUploadService,
    private readonly uploadParts: UploadPartsService,
    private readonly completeUpload: CompleteVideoUploadService,
    private readonly abortUpload: AbortVideoUploadService,
    private readonly ownVideos: OwnVideosService,
    private readonly videoAccess: VideoAccessService,
  ) {}

  @Get(':publicId/download-url')
  @ApiParam({
    name: 'publicId',
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{12}$' },
  })
  @ApiOperation({
    summary: 'Issue a download URL for an own ready video',
    description:
      'Returns an expiring JSON URL for the original object, not a redirect or binary body. Storage serves attachment disposition with the sanitized, escaped original filename and an independent configured download lifetime. The URL is a bearer credential until expiry; renewal requires the owner again and does not publish the video.',
  })
  @ApiResponse({
    status: 200,
    description: 'Original attachment URL and configured download expiration',
    type: SignedUrlResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: malformed public ID',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: {
      type: 'object',
      required: ['message', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'integer', example: 401 },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND: video missing or outside caller ownership',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'VIDEO_NOT_READY: video has not reached ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'STORAGE_UNAVAILABLE: temporary signing failure',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Inherited global throttler limit exceeded',
  })
  async downloadUrl(
    @CurrentUser() user: JwtPayload,
    @Param() params: VideoPublicIdParamsDto,
  ): Promise<SignedUrlResponseDto> {
    return await this.videoAccess.download(params.publicId, user.sub);
  }

  @Get(':publicId/playback-url')
  @ApiParam({
    name: 'publicId',
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{12}$' },
  })
  @ApiOperation({
    summary: 'Issue a playback URL for an own ready video',
    description:
      'Returns JSON, not a redirect or video bytes. The expiring URL is a bearer credential for the original object; storage serves reusable Range requests for seeking. Renewal requires owner authentication again. Browser codec support depends on the original format; ready does not publish the video.',
  })
  @ApiResponse({
    status: 200,
    description: 'Inline original URL and configured expiration',
    type: SignedUrlResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: malformed public ID',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: {
      type: 'object',
      required: ['message', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'integer', example: 401 },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND: video missing or outside caller ownership',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'VIDEO_NOT_READY: video has not reached ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'STORAGE_UNAVAILABLE: temporary signing failure',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Inherited global throttler limit exceeded',
  })
  async playbackUrl(
    @CurrentUser() user: JwtPayload,
    @Param() params: VideoPublicIdParamsDto,
  ): Promise<SignedUrlResponseDto> {
    return await this.videoAccess.playback(params.publicId, user.sub);
  }

  @Get()
  @ApiOperation({
    summary: 'List own videos',
    description:
      'Returns only the authenticated caller’s videos, ordered by created_at DESC then id DESC. Returns an empty array when there are none. No owner selector, filtering, pagination or publishing contract is provided.',
  })
  @ApiResponse({
    status: 200,
    description: 'Own videos, or an empty array',
    type: VideoResponseDto,
    isArray: true,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: {
      type: 'object',
      required: ['message', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'integer', example: 401 },
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Inherited global throttler limit exceeded',
  })
  async list(@CurrentUser() user: JwtPayload): Promise<VideoResponseDto[]> {
    return await this.ownVideos.list(user.sub);
  }

  @Get(':publicId')
  @ApiParam({
    name: 'publicId',
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{12}$' },
  })
  @ApiOperation({
    summary: 'Retrieve an own video',
    description:
      'Owner-only, read-only lookup in every lifecycle state by immutable 12-character public ID, not the internal UUID. Returns the retained session state/deadline and nullable processing results; never renews an upload or publishes a video.',
  })
  @ApiResponse({
    status: 200,
    description: 'Own video and upload session',
    type: OwnVideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: malformed public ID',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: {
      type: 'object',
      required: ['message', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'integer', example: 401 },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND: video missing or outside caller ownership',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Inherited global throttler limit exceeded',
  })
  async detail(
    @CurrentUser() user: JwtPayload,
    @Param() params: VideoPublicIdParamsDto,
  ): Promise<OwnVideoResponseDto> {
    return await this.ownVideos.detail(params.publicId, user.sub);
  }

  @Post('uploads')
  @HttpCode(201)
  @ApiConsumes('application/json')
  @ApiBody({ type: StartVideoUploadDto })
  @ApiOperation({
    summary: 'Start a resumable video upload',
    description:
      'Creates a new draft and active upload session for the caller’s channel. Accepts JSON metadata for at most 10 GiB (10737418240 bytes); source bytes are uploaded directly to storage.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft and active upload session created',
    type: StartVideoUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: invalid metadata or unknown fields',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: {
      type: 'object',
      required: ['message', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'integer', example: 401 },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'CHANNEL_NOT_FOUND: caller has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Inherited global throttler limit exceeded',
  })
  @ApiResponse({
    status: 500,
    description: 'VIDEO_ID_ALLOCATION_FAILED: three public-ID collisions',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'STORAGE_UNAVAILABLE: temporary storage failure',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async start(
    @CurrentUser() user: JwtPayload,
    @Body() dto: StartVideoUploadDto,
  ): Promise<StartVideoUploadResponseDto> {
    return await this.startUpload.start(user.sub, dto);
  }

  @Post(':publicId/upload/parts')
  @HttpCode(200)
  @ApiConsumes('application/json')
  @ApiBody({ type: SignUploadPartsDto })
  @ApiParam({
    name: 'publicId',
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{12}$' },
  })
  @ApiOperation({
    summary: 'Sign upload part PUT URLs',
    description:
      'Owner-only renewal for an active, unexpired session. PUT bytes directly to the returned public storage URLs; no extra signed headers are required. URLs last at most 900 seconds and never beyond the session deadline. Preserve the signed hostname and returned ETags.',
  })
  @ApiResponse({
    status: 200,
    description: 'Requested part URLs with expiration times',
    type: SignUploadPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_ERROR: malformed path/body, duplicate part numbers or unknown fields',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: {
      type: 'object',
      required: ['message', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'integer', example: 401 },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND: missing or foreign-owned video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'UPLOAD_NOT_ACTIVE or UPLOAD_PARTS_INVALID',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Inherited global throttler limit exceeded',
  })
  @ApiResponse({
    status: 503,
    description: 'STORAGE_UNAVAILABLE: temporary storage/signing failure',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async signParts(
    @CurrentUser() user: JwtPayload,
    @Param() params: VideoPublicIdParamsDto,
    @Body() dto: SignUploadPartsDto,
  ): Promise<SignUploadPartsResponseDto> {
    return await this.uploadParts.sign(
      params.publicId,
      user.sub,
      dto.part_numbers,
    );
  }

  @Get(':publicId/upload/parts')
  @HttpCode(200)
  @ApiParam({
    name: 'publicId',
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{12}$' },
  })
  @ApiOperation({
    summary: 'List uploaded parts for resumption',
    description:
      'Owner-only inventory for an active, unexpired session. Aggregates every storage page into one sorted response with actual ETags and sizes. Derive missing numbers from total_parts and renew only those parts. No client storage references or continuation tokens are used. Closed/expired sessions return 409; use video retrieval after completion.',
  })
  @ApiResponse({
    status: 200,
    description: 'Existing upload session and complete uploaded-part inventory',
    type: ListUploadedPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: malformed public ID',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: {
      type: 'object',
      required: ['message', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'integer', example: 401 },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND: missing or foreign-owned video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'UPLOAD_NOT_ACTIVE: closed or expired upload session',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Inherited global throttler limit exceeded',
  })
  @ApiResponse({
    status: 503,
    description: 'STORAGE_UNAVAILABLE: temporary inventory retrieval failure',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async listParts(
    @CurrentUser() user: JwtPayload,
    @Param() params: VideoPublicIdParamsDto,
  ): Promise<ListUploadedPartsResponseDto> {
    return await this.uploadParts.list(params.publicId, user.sub);
  }

  @Post(':publicId/upload/complete')
  @HttpCode(202)
  @ApiConsumes('application/json')
  @ApiBody({ type: CompleteVideoUploadDto })
  @ApiParam({
    name: 'publicId',
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{12}$' },
  })
  @ApiOperation({
    summary: 'Complete a verified video upload',
    description:
      'Verifies the contiguous storage inventory and final object size, then commits completed-session/processing-video intent before publishing. HTTP 202 acknowledges asynchronous processing, not readiness. Repeated completion returns the current video without another job. Lost storage responses and matching objects at the deadline are recovered; unfinished uploads are not completed after expiry. A recoverable post-commit queue outage leaves durable intent for reconciliation.',
  })
  @ApiResponse({
    status: 202,
    description:
      'Durable processing intent, or the current video for an already completed session',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: malformed manifest/path or unknown fields',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: {
      type: 'object',
      required: ['message', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'integer', example: 401 },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND: missing or foreign-owned video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description:
      'UPLOAD_NOT_ACTIVE, UPLOAD_PARTS_INVALID or UPLOAD_SIZE_MISMATCH; required cleanup/error transitions commit before size rejection',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Inherited global throttler limit exceeded',
  })
  @ApiResponse({
    status: 503,
    description:
      'STORAGE_UNAVAILABLE: verification/cleanup remains pending for retry',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async complete(
    @CurrentUser() user: JwtPayload,
    @Param() params: VideoPublicIdParamsDto,
    @Body() dto: CompleteVideoUploadDto,
  ): Promise<VideoResponseDto> {
    return await this.completeUpload.complete(
      params.publicId,
      user.sub,
      dto.parts,
    );
  }

  @Post(':publicId/upload/abort')
  @HttpCode(204)
  @ApiParam({
    name: 'publicId',
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{12}$' },
  })
  @ApiOperation({
    summary: 'Abort an active video upload',
    description:
      'Owner-only cancellation with no request body or query parameters. Retains the draft identity and closes its single session. Repeated aborted/expired sessions are idempotent. Completion and expiry serialize on the same session lock; a verified completed object is recovered and retained, returning UPLOAD_NOT_ACTIVE rather than claiming cancellation. Required storage cleanup failures remain pending for retry.',
  })
  @ApiResponse({
    status: 204,
    description: 'Upload aborted, or already aborted/expired; no response body',
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR: malformed public ID',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: {
      type: 'object',
      required: ['message', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'integer', example: 401 },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND: missing or foreign-owned video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description:
      'UPLOAD_NOT_ACTIVE: completion already won or its verified object was recovered',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description: 'Inherited global throttler limit exceeded',
  })
  @ApiResponse({
    status: 503,
    description:
      'STORAGE_UNAVAILABLE: required abort/verification remains pending',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async abort(
    @CurrentUser() user: JwtPayload,
    @Param() params: VideoPublicIdParamsDto,
  ): Promise<void> {
    await this.abortUpload.abort(params.publicId, user.sub);
  }
}
