import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { INTERNAL_S3_CLIENT, PUBLIC_S3_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

@Module({
  imports: [
    ConfigModule.forFeature(storageConfig),
    ConfigModule.forFeature(videoConfig),
  ],
  providers: [
    ...(
      [
        [INTERNAL_S3_CLIENT, 'internalEndpoint'],
        [PUBLIC_S3_CLIENT, 'publicEndpoint'],
      ] as const
    ).map(([token, endpoint]) => ({
      provide: token,
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>) =>
        new S3Client({
          endpoint: config[endpoint],
          region: config.region,
          credentials: config.credentials,
          forcePathStyle: config.forcePathStyle,
          // UploadPart signatures must not bind an empty-body optional checksum.
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        }),
    })),
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
