export class VideoQueueUnavailableError extends Error {
  constructor(public override readonly cause?: unknown) {
    super('Video processing queue is temporarily unavailable');
    this.name = 'VideoQueueUnavailableError';
  }
}
