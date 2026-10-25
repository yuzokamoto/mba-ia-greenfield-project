import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import queueConfig from '../../config/queue.config';
import { VideoProcessingProducer } from './video-processing-producer.service';
import {
  VIDEO_PRODUCER_COMMAND_TIMEOUT_MS,
  VIDEO_PRODUCER_CONFIG_KEY,
  VIDEO_QUEUE_REGISTRATION,
} from './video-queue.constants';

@Module({
  imports: [
    ConfigModule.forFeature(queueConfig),
    BullModule.forRootAsync(VIDEO_PRODUCER_CONFIG_KEY, {
      imports: [ConfigModule.forFeature(queueConfig)],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: {
          ...config.connection,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: VIDEO_PRODUCER_COMMAND_TIMEOUT_MS,
          commandTimeout: VIDEO_PRODUCER_COMMAND_TIMEOUT_MS,
        },
      }),
    }),
    BullModule.registerQueueAsync({
      name: VIDEO_QUEUE_REGISTRATION,
      configKey: VIDEO_PRODUCER_CONFIG_KEY,
      imports: [ConfigModule.forFeature(queueConfig)],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        name: config.name,
        forceDisconnectOnShutdown: true,
      }),
    }),
  ],
  providers: [VideoProcessingProducer],
  exports: [VideoProcessingProducer],
})
export class VideoQueueModule {}
