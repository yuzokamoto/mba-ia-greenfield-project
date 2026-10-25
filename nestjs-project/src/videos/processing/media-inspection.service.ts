import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videoConfig from '../../config/video.config';
import { MAX_THUMBNAIL_BYTES } from '../../storage/storage.constants';
import { StorageService } from '../../storage/storage.service';
import { InvalidMediaError, MediaProcessError } from './media.errors';
import { MediaProcessService } from './media-process.service';
import { MediaSourceService } from './media-source.service';

export interface InspectedMedia {
  duration: number;
  metadata: Record<string, unknown>;
  thumbnailKey: string;
}

@Injectable()
export class MediaInspectionService {
  private formats?: string;
  constructor(
    private readonly storage: StorageService,
    private readonly process: MediaProcessService,
    private readonly sources: MediaSourceService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  parseProbe(body: Buffer): {
    duration: number;
    metadata: Record<string, unknown>;
  } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString());
    } catch {
      throw new InvalidMediaError();
    }
    if (!parsed || typeof parsed !== 'object') throw new InvalidMediaError();
    const probe = parsed as {
      format?: { duration?: unknown; format_name?: unknown };
      streams?: {
        codec_type?: unknown;
        codec_name?: unknown;
        width?: unknown;
        height?: unknown;
        duration?: unknown;
      }[];
    };
    const stream = Array.isArray(probe.streams)
      ? probe.streams.find((entry) => entry && entry.codec_type === 'video')
      : undefined;
    const duration = Number(probe.format?.duration ?? stream?.duration);
    if (
      !stream ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      typeof probe.format?.format_name !== 'string' ||
      typeof stream.codec_name !== 'string'
    )
      throw new InvalidMediaError();
    return {
      duration,
      metadata: {
        container: probe.format.format_name.slice(0, 128),
        video: {
          codec: stream.codec_name.slice(0, 128),
          ...(Number.isInteger(stream.width) && Number(stream.width) > 0
            ? { width: stream.width }
            : {}),
          ...(Number.isInteger(stream.height) && Number(stream.height) > 0
            ? { height: stream.height }
            : {}),
        },
      },
    };
  }

  async inspect(videoId: string, originalKey: string): Promise<InspectedMedia> {
    const deadline = Date.now() + this.config.mediaTimeoutMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    if (!this.formats) {
      const available = await this.process.run(
        'ffprobe',
        ['-v', 'error', '-formats'],
        remaining(),
        128 * 1024,
      );
      // Deny reference/playlist demuxers; preserve all installed self-contained formats/codecs.
      const references = new Set([
        'hls',
        'applehttp',
        'dash',
        'concat',
        'sdp',
        'rtsp',
        'webm_dash_manifest',
      ]);
      this.formats = [...available.toString().matchAll(/^\s*D[ E]\s+(\S+)/gm)]
        .flatMap((match) => match[1].split(','))
        .filter((name) => !references.has(name))
        .join(',');
      if (!this.formats) throw new MediaProcessError('spawn');
    }
    const signed = await this.storage.signInternalGet(originalKey);
    const source = await this.sources.open(signed.url, remaining());
    const env = {
      ...process.env,
      http_proxy: source.proxy,
      HTTP_PROXY: source.proxy,
      no_proxy: '',
      NO_PROXY: '',
    };
    const input = [
      '-protocol_whitelist',
      'http,https,tcp,tls',
      '-format_whitelist',
      this.formats,
      '-enable_drefs',
      '0',
      '-use_absolute_path',
      '0',
    ];
    try {
      let probe: Buffer;
      try {
        probe = await this.process.run(
          'ffprobe',
          [
            '-v',
            'error',
            ...input,
            '-show_format',
            '-show_streams',
            '-of',
            'json',
            signed.url,
          ],
          remaining(),
          128 * 1024,
          env,
        );
      } catch (error: unknown) {
        if (
          error instanceof MediaProcessError &&
          error.reason === 'exit' &&
          !source.unavailable()
        )
          throw new InvalidMediaError();
        throw error;
      }
      const result = this.parseProbe(probe);
      // FFmpeg rejects MOV-private options when the detected input is another
      // demuxer; ffprobe accepts them while probing. MOV defaults stay disabled.
      const frameInput = String(result.metadata.container)
        .split(',')
        .includes('mov')
        ? input
        : input.slice(0, 4);
      const extract = async (seek: number) =>
        await this.process.run(
          'ffmpeg',
          [
            '-nostdin',
            '-v',
            'error',
            ...frameInput,
            '-ss',
            String(seek),
            '-i',
            signed.url,
            '-map',
            '0:v:0',
            '-frames:v',
            '1',
            '-threads',
            '1',
            '-vf',
            'scale=640:-2',
            '-f',
            'image2pipe',
            '-c:v',
            'mjpeg',
            'pipe:1',
          ],
          remaining(),
          MAX_THUMBNAIL_BYTES,
          env,
        );
      let jpeg: Buffer;
      try {
        jpeg = await extract(Math.min(1, result.duration / 2));
        if (!jpeg.length) jpeg = await extract(0);
      } catch (error: unknown) {
        if (
          error instanceof MediaProcessError &&
          error.reason === 'exit' &&
          !source.unavailable()
        )
          jpeg = await extract(0);
        else throw error;
      }
      if (source.blocked()) throw new InvalidMediaError();
      if (source.unavailable()) throw new MediaProcessError('exit');
      if (jpeg.length < 3 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8)
        throw new InvalidMediaError();
      const thumbnailKey = `videos/${videoId}/thumbnail.jpg`;
      await this.storage.uploadJpeg(thumbnailKey, jpeg);
      return { ...result, thumbnailKey };
    } finally {
      await source.close();
    }
  }
}
