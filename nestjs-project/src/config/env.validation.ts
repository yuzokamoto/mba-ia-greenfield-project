import * as Joi from 'joi';

const positiveInteger = Joi.number().integer().positive().required();
const signingTtl = positiveInteger.max(7 * 24 * 60 * 60);
const httpEndpoint = Joi.string()
  .uri({ scheme: ['http', 'https'] })
  .required();

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  S3_INTERNAL_ENDPOINT: httpEndpoint,
  S3_PUBLIC_ENDPOINT: httpEndpoint,
  S3_REGION: Joi.string().trim().required(),
  S3_BUCKET: Joi.string().trim().required(),
  S3_ACCESS_KEY_ID: Joi.string().required(),
  S3_SECRET_ACCESS_KEY: Joi.string().required(),
  S3_FORCE_PATH_STYLE: Joi.boolean().required(),
  S3_CORS_ALLOWED_ORIGINS: Joi.string()
    .custom((value: string, helpers) => {
      const valid = value.split(',').every((origin) => {
        try {
          const url = new URL(origin);
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.hostname.includes('*') &&
            url.origin === origin
          );
        } catch {
          return false;
        }
      });
      return valid ? value : helpers.error('any.invalid');
    })
    .required(),
  MINIO_ROOT_USER: Joi.string().required(),
  MINIO_ROOT_PASSWORD: Joi.string().required(),
  REDIS_HOST: Joi.string().hostname().required(),
  REDIS_PORT: Joi.number().port().positive().required(),
  REDIS_USERNAME: Joi.string().optional(),
  REDIS_PASSWORD: Joi.string().optional(),
  REDIS_DB: Joi.number().integer().min(0).required(),
  VIDEO_PROCESSING_QUEUE: Joi.string()
    .pattern(/^[^:\s]+$/)
    .required(),
  VIDEO_PROCESSING_BACKOFF_MS: positiveInteger,
  VIDEO_RECONCILE_INTERVAL_MS: positiveInteger,
  VIDEO_PLAYBACK_URL_TTL_SECONDS: signingTtl,
  VIDEO_DOWNLOAD_URL_TTL_SECONDS: signingTtl,
  VIDEO_MEDIA_READ_URL_TTL_SECONDS: signingTtl,
  VIDEO_MEDIA_TIMEOUT_MS: positiveInteger,
  VIDEO_WORKER_CPUS: Joi.number().positive().required(),
  VIDEO_WORKER_MEMORY: Joi.string()
    .pattern(/^(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)(?:b|k|kb|m|mb|g|gb)?$/i)
    .required(),
})
  .custom((value: Record<string, unknown>, helpers) => {
    if (
      Number(value.VIDEO_MEDIA_READ_URL_TTL_SECONDS) * 1000 <
      Number(value.VIDEO_MEDIA_TIMEOUT_MS)
    ) {
      return helpers.error('video.mediaLifetime');
    }
    return value;
  })
  .messages({
    'video.mediaLifetime':
      'VIDEO_MEDIA_READ_URL_TTL_SECONDS must cover VIDEO_MEDIA_TIMEOUT_MS',
  });
