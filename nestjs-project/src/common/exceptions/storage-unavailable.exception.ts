import { DomainException } from './domain.exception';

export class StorageUnavailableException extends DomainException {
  constructor(public override readonly cause?: unknown) {
    super('STORAGE_UNAVAILABLE', 503, 'Storage is temporarily unavailable');
  }
}
