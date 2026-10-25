import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  reconcileIntervalMs: Number(process.env.VIDEO_RECONCILE_INTERVAL_MS),
  playbackUrlTtlSeconds: Number(process.env.VIDEO_PLAYBACK_URL_TTL_SECONDS),
  downloadUrlTtlSeconds: Number(process.env.VIDEO_DOWNLOAD_URL_TTL_SECONDS),
  mediaReadUrlTtlSeconds: Number(process.env.VIDEO_MEDIA_READ_URL_TTL_SECONDS),
  mediaTimeoutMs: Number(process.env.VIDEO_MEDIA_TIMEOUT_MS),
  workerCpus: Number(process.env.VIDEO_WORKER_CPUS),
  workerMemory: process.env.VIDEO_WORKER_MEMORY!,
}));
