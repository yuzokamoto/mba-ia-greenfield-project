// Colons are forbidden in Redis queue names, so this DI token cannot collide.
export const VIDEO_QUEUE_REGISTRATION = 'video-processing:producer' as const;
export const VIDEO_PRODUCER_CONFIG_KEY = 'video-producer' as const;
export const PROCESS_VIDEO_JOB = 'process-video' as const;
export const VIDEO_PROCESSING_ATTEMPTS = 3 as const;
export const VIDEO_PRODUCER_COMMAND_TIMEOUT_MS = 2000 as const;
