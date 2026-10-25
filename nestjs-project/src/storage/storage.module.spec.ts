import { Test } from '@nestjs/testing';
import { INTERNAL_S3_CLIENT, PUBLIC_S3_CLIENT } from './storage.constants';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageModule', () => {
  it('should resolve the adapter and close both controlled clients without network I/O', async () => {
    const internal = { destroy: jest.fn() };
    const publicClient = { destroy: jest.fn() };
    const module = await Test.createTestingModule({ imports: [StorageModule] })
      .overrideProvider(INTERNAL_S3_CLIENT)
      .useValue(internal)
      .overrideProvider(PUBLIC_S3_CLIENT)
      .useValue(publicClient)
      .compile();
    expect(module.get(StorageService)).toBeInstanceOf(StorageService);
    await module.close();
    expect(internal.destroy).toHaveBeenCalledTimes(1);
    expect(publicClient.destroy).toHaveBeenCalledTimes(1);
  });
});
