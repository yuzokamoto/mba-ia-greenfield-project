import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource, DeepPartial } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { UploadSession } from '../videos/entities/upload-session.entity';
import { Video } from '../videos/entities/video.entity';

export const VIDEO_TEST_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  UploadSession,
];

export async function createVideoFixture(
  dataSource: DataSource,
  overrides: DeepPartial<Video> = {},
): Promise<Video> {
  let channelId = overrides.channel_id;
  if (!channelId) {
    const user = await dataSource
      .getRepository(User)
      .save({ email: `${randomUUID()}@example.com`, password: 'fixture-hash' });
    const channel = await dataSource.getRepository(Channel).save({
      user_id: user.id,
      name: 'Fixture channel',
      nickname: randomUUID(),
    });
    channelId = channel.id;
  }
  const id = randomUUID();
  const repository = dataSource.getRepository(Video);
  return await repository.save(
    repository.create({
      id,
      channel_id: channelId,
      public_id: randomBytes(9).toString('base64url'),
      title: 'Fixture video',
      original_filename: 'fixture.mp4',
      content_type: 'video/mp4',
      original_key: `videos/${id}/original`,
      declared_size: '10',
      ...overrides,
    }),
  );
}
