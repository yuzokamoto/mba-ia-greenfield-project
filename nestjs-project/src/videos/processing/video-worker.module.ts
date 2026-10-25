import { BullModule, OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Module, Logger } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import databaseConfig from '../../config/database.config';
import queueConfig from '../../config/queue.config';
import { runtimeConfigOptions } from '../../config/runtime-config';
import { StorageModule } from '../../storage/storage.module';
import { User } from '../../users/entities/user.entity';
import { UploadSession } from '../entities/upload-session.entity';
import { Video } from '../entities/video.entity';
import { VideoPersistenceModule } from '../video-persistence.module';
import { VideoQueueModule } from '../queue/video-queue.module';
import { UploadLifecycleModule } from '../uploads/upload-lifecycle.module';
import { MediaInspectionModule } from './media-inspection.module';
import { VideoProcessingService } from './video-processing.service';
import { VideoProcessor } from './video.processor';
import { VideoReconcilerService } from './video-reconciler.service';

export const VIDEO_WORKER_CONFIG = 'video-worker' as const;
// This registration is a DI name, never the configured Redis queue name.
export const VIDEO_WORKER_QUEUE = 'video-processing:worker' as const;

@Module({
  imports: [
    ConfigModule.forRoot(runtimeConfigOptions),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        database: config.name,
        entities: [User, Channel, Video, UploadSession],
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    VideoPersistenceModule,
    UploadLifecycleModule,
    VideoQueueModule,
    StorageModule,
    MediaInspectionModule,
    BullModule.forRootAsync(VIDEO_WORKER_CONFIG, {
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: { ...config.connection, maxRetriesPerRequest: null },
      }),
    }),
    BullModule.registerQueueAsync({
      name: VIDEO_WORKER_QUEUE,
      configKey: VIDEO_WORKER_CONFIG,
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        name: config.name,
      }),
    }),
  ],
  providers: [
    VideoProcessingService,
    VideoReconcilerService,
    {
      provide: VideoProcessor,
      inject: [VideoProcessingService, queueConfig.KEY],
      useFactory: (
        processing: VideoProcessingService,
        config: ConfigType<typeof queueConfig>,
      ) => {
        // Nest discovers factory-provided processors by their runtime constructor.
        @Processor(
          { name: config.name, configKey: VIDEO_WORKER_CONFIG },
          {
            concurrency: 1,
            // BullExplorer may discover another Queue's options by name first.
            connection: { ...config.connection, maxRetriesPerRequest: null },
          },
        )
        class ConfiguredVideoProcessor extends VideoProcessor {
          @OnWorkerEvent('error')
          reportError(): void {
            new Logger(VideoProcessor.name).warn(
              'Video worker queue connection error',
            );
          }
        }
        return new ConfiguredVideoProcessor(processing);
      },
    },
  ],
  exports: [VideoProcessingService, VideoProcessor],
})
export class VideoWorkerModule {}
