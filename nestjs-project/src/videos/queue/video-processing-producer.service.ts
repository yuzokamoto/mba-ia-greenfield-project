import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue, type Job } from 'bullmq';
import queueConfig from '../../config/queue.config';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_ATTEMPTS,
  VIDEO_QUEUE_REGISTRATION,
} from './video-queue.constants';
import { VideoQueueUnavailableError } from './video-queue-unavailable.error';

export interface VideoProcessingPayload {
  videoId: string;
}

@Injectable()
export class VideoProcessingProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoProcessingProducer.name);
  // Avoid logging Redis credentials, raw connection errors, or unbounded output.
  private readonly onQueueError = (): void => {
    this.logger.warn('Video processing queue connection error');
  };

  constructor(
    @InjectQueue(VIDEO_QUEUE_REGISTRATION)
    private readonly queue: Queue<VideoProcessingPayload>,
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
  ) {
    this.queue.on('error', this.onQueueError);
  }

  async onModuleInit(): Promise<void> {
    await this.queue.waitUntilReady();
  }

  async enqueue(
    videoId: string,
    remainingAttempts: number = VIDEO_PROCESSING_ATTEMPTS,
  ): Promise<Job<VideoProcessingPayload>> {
    this.validateVideoId(videoId);
    if (
      !Number.isInteger(remainingAttempts) ||
      remainingAttempts < 1 ||
      remainingAttempts > VIDEO_PROCESSING_ATTEMPTS
    )
      throw new RangeError('Invalid remaining video processing budget');
    return await this.execute(
      async () =>
        await this.queue.add(
          PROCESS_VIDEO_JOB,
          { videoId },
          {
            jobId: this.jobId(videoId),
            attempts: remainingAttempts,
            backoff: {
              type: 'exponential',
              delay: this.config.processingBackoffMs,
            },
            removeOnComplete: false,
            removeOnFail: false,
          },
        ),
    );
  }

  async findJob(
    videoId: string,
  ): Promise<Job<VideoProcessingPayload> | undefined> {
    this.validateVideoId(videoId);
    return await this.execute(
      async () => await this.queue.getJob(this.jobId(videoId)),
    );
  }

  private jobId(videoId: string): string {
    return `video-${videoId}`;
  }

  private validateVideoId(videoId: string): void {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(videoId))
      throw new TypeError('Video processing payload requires a UUID videoId');
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null) {
        const code = 'code' in error ? String(error.code) : '';
        const name = 'name' in error ? String(error.name) : '';
        const message = 'message' in error ? String(error.message) : '';
        if (
          [
            'ECONNREFUSED',
            'ECONNRESET',
            'ETIMEDOUT',
            'EAI_AGAIN',
            'ENOTFOUND',
          ].includes(code) ||
          name === 'MaxRetriesPerRequestError' ||
          /^(Connection is closed\.?|Stream isn't writeable and enableOfflineQueue options is false|Command timed out)/.test(
            message,
          )
        ) {
          throw new VideoQueueUnavailableError(error);
        }
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.queue.close();
    } finally {
      this.queue.off('error', this.onQueueError);
    }
  }
}
