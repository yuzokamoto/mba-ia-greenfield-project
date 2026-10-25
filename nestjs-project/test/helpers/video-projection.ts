import type { VideoResponseDto } from '../../src/videos/dto/video-response.dto';
import type { Video } from '../../src/videos/entities/video.entity';

export function expectVideoProjection(
  actual: VideoResponseDto,
  seeded: Video,
): void {
  expect(actual).toEqual({
    id: seeded.id,
    public_id: seeded.public_id,
    channel_id: seeded.channel_id,
    title: seeded.title,
    status: seeded.status,
    failure_reason: seeded.failure_reason,
    original_filename: seeded.original_filename,
    content_type: seeded.content_type,
    declared_size: Number(seeded.declared_size),
    duration: seeded.duration,
    metadata: seeded.metadata,
    created_at: seeded.created_at.toISOString(),
    updated_at: seeded.updated_at.toISOString(),
  });
  for (const id of [actual.id, actual.channel_id])
    expect(id).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
  expect(actual.public_id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect(Number.isInteger(actual.declared_size)).toBe(true);
  for (const date of [actual.created_at, actual.updated_at])
    expect(new Date(date).toISOString()).toBe(date);
}
