import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { VideoIdAllocationFailedException } from './exceptions/video.exceptions';

@Injectable()
export class PublicIdGenerator {
  generate(): string {
    return randomBytes(9).toString('base64url');
  }
}

export async function reservePublicId<T>(
  insert: (publicId: string) => Promise<T>,
  generate: () => string,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await insert(generate());
    } catch (error: unknown) {
      if (!(error instanceof QueryFailedError)) throw error;
      const driver = error.driverError as {
        code?: unknown;
        constraint?: unknown;
      };
      if (
        driver.code !== '23505' ||
        driver.constraint !== 'UQ_videos_public_id'
      )
        throw error;
    }
  }
  throw new VideoIdAllocationFailedException();
}
