import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  connection: {
    host: process.env.REDIS_HOST!,
    port: Number(process.env.REDIS_PORT),
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    db: Number(process.env.REDIS_DB),
  },
  name: process.env.VIDEO_PROCESSING_QUEUE!,
  processingBackoffMs: Number(process.env.VIDEO_PROCESSING_BACKOFF_MS),
}));
