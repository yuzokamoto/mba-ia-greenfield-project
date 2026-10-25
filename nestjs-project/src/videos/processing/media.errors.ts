export class InvalidMediaError extends Error {
  constructor() {
    super('invalid_media');
  }
}

export class MediaProcessError extends Error {
  constructor(
    readonly reason: 'exit' | 'timeout' | 'output' | 'shutdown' | 'spawn',
    readonly diagnostic = '',
  ) {
    super('Media operation failed');
  }
}
