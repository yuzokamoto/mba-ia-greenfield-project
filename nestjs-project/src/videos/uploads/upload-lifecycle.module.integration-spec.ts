import { AuthService } from '../../auth/auth.service';
import { createUploadLifecycleTestContext } from '../../test/create-upload-lifecycle-test-context';
import { UploadFinalizationService } from './upload-finalization.service';
import { UploadTerminationService } from './upload-termination.service';

describe('UploadLifecycleModule (integration)', () => {
  it('should resolve real storage/persistence without importing the API or authentication graph', async () => {
    const context = await createUploadLifecycleTestContext();
    try {
      expect(context.module.get(UploadFinalizationService)).toBe(
        context.finalizer,
      );
      expect(context.module.get(UploadTerminationService)).toBeInstanceOf(
        UploadTerminationService,
      );
      expect(() => context.module.get(AuthService)).toThrow();
    } finally {
      await context.close();
    }
  });
});
