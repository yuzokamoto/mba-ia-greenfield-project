import type { ConfigModuleOptions } from '@nestjs/config';
import appConfig from './app.config';
import authConfig from './auth.config';
import databaseConfig from './database.config';
import { envValidationSchema } from './env.validation';
import mailConfig from './mail.config';
import queueConfig from './queue.config';
import storageConfig from './storage.config';
import swaggerConfig from './swagger.config';
import videoConfig from './video.config';

// Shared by API and standalone worker, without loading either process's modules.
export const runtimeConfigOptions = {
  isGlobal: true,
  load: [
    appConfig,
    authConfig,
    databaseConfig,
    mailConfig,
    swaggerConfig,
    storageConfig,
    queueConfig,
    videoConfig,
  ],
  validationSchema: envValidationSchema,
  validationOptions: { allowUnknown: true, abortEarly: false },
} satisfies ConfigModuleOptions;
