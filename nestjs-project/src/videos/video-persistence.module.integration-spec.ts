import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { createTestDataSource } from '../test/create-test-data-source';
import { VIDEO_TEST_ENTITIES } from '../test/video-test-data';
import { UploadSession } from './entities/upload-session.entity';
import { Video } from './entities/video.entity';
import { VideoPersistenceModule } from './video-persistence.module';

describe('VideoPersistenceModule (integration)', () => {
  it('should resolve and export the configured entity repositories without an HTTP graph', async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(
          createTestDataSource(VIDEO_TEST_ENTITIES, { synchronize: false })
            .options,
        ),
        VideoPersistenceModule,
      ],
    }).compile();
    try {
      expect(module.get(getRepositoryToken(Video))).toBeDefined();
      expect(module.get(getRepositoryToken(UploadSession))).toBeDefined();
    } finally {
      await module.close();
    }
  });
});
