import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  internalEndpoint: process.env.S3_INTERNAL_ENDPOINT!,
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT!,
  region: process.env.S3_REGION!,
  bucket: process.env.S3_BUCKET!,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE!.toLowerCase() === 'true',
  corsAllowedOrigins: process.env.S3_CORS_ALLOWED_ORIGINS!.split(','),
}));
