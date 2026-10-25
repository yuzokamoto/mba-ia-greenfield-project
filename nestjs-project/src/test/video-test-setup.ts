import { applyVideoTestEnvironment } from './video-test-environment';

const environment = applyVideoTestEnvironment();

afterAll(async () => {
  await environment.cleanup();
});
