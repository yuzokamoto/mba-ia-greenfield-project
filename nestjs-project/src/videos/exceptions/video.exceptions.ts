import { DomainException } from '../../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}
export class UploadNotActiveException extends DomainException {
  constructor() {
    super('UPLOAD_NOT_ACTIVE', 409, 'Upload session is not active');
  }
}
export class UploadPartsInvalidException extends DomainException {
  constructor() {
    super(
      'UPLOAD_PARTS_INVALID',
      409,
      'Uploaded parts do not match the expected upload',
    );
  }
}
export class UploadSizeMismatchException extends DomainException {
  constructor() {
    super(
      'UPLOAD_SIZE_MISMATCH',
      409,
      'Uploaded size does not match the declared size',
    );
  }
}
export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready');
  }
}
export class VideoIdAllocationFailedException extends DomainException {
  constructor() {
    super(
      'VIDEO_ID_ALLOCATION_FAILED',
      500,
      'Video identifier could not be allocated',
    );
  }
}
