import { UPLOAD_MAX_BYTES } from './videos.constants';

export function parseDeclaredSize(value: string): number {
  const size = Number(value);
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(size) ||
    size > UPLOAD_MAX_BYTES
  ) {
    throw new RangeError(
      'Persisted declared size is outside the safe video size range',
    );
  }
  return size;
}
