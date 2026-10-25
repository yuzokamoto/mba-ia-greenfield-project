export const VIDEO_TEST_BUCKET = 'streamtube-videos-test' as const;
export const VIDEO_TEST_QUEUE = 'video-processing-test' as const;

type CleanupHook = () => void | Promise<void>;

export interface VideoTestEnvironment {
  addCleanup: (hook: CleanupHook) => void;
  restore: () => void;
  cleanup: () => Promise<void>;
}

// Call after dotenv, before evaluating factories or constructing modules/clients.
export function applyVideoTestEnvironment(): VideoTestEnvironment {
  const internalEndpoint = process.env.S3_INTERNAL_ENDPOINT;
  if (!internalEndpoint) {
    throw new Error(
      'S3_INTERNAL_ENDPOINT must be loaded before test overrides',
    );
  }

  const overrides = {
    S3_BUCKET: VIDEO_TEST_BUCKET,
    VIDEO_PROCESSING_QUEUE: VIDEO_TEST_QUEUE,
    S3_PUBLIC_ENDPOINT: internalEndpoint,
  };
  const previous = new Map(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, overrides);
  const hooks: CleanupHook[] = [];
  let restored = false;

  const restore = (): void => {
    if (restored) return;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restored = true;
  };

  return {
    addCleanup: (hook) => hooks.push(hook),
    restore,
    async cleanup(): Promise<void> {
      const errors: unknown[] = [];
      try {
        while (hooks.length) {
          try {
            await hooks.pop()!();
          } catch (error) {
            errors.push(error);
          }
        }
      } finally {
        restore();
      }
      if (errors.length)
        throw new AggregateError(errors, 'Video test cleanup failed');
    },
  };
}

export function assertVideoTestEnvironment(): void {
  if (
    process.env.S3_BUCKET !== VIDEO_TEST_BUCKET ||
    process.env.VIDEO_PROCESSING_QUEUE !== VIDEO_TEST_QUEUE ||
    !process.env.S3_INTERNAL_ENDPOINT ||
    process.env.S3_PUBLIC_ENDPOINT !== process.env.S3_INTERNAL_ENDPOINT
  ) {
    throw new Error(
      'Apply the isolated video test environment before opening clients',
    );
  }
}
