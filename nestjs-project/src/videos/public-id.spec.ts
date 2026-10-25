import { QueryFailedError } from 'typeorm';
import { PublicIdGenerator, reservePublicId } from './public-id';

describe('Public ID reservation', () => {
  const collision = (constraint = 'UQ_videos_public_id', code = '23505') =>
    new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error('conflict'), { code, constraint }),
    );

  it('should generate 12 base64url characters from native randomness', () => {
    const generator = new PublicIdGenerator();
    const ids = new Set(
      Array.from({ length: 100 }, () => generator.generate()),
    );
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it('should retry only the named public ID constraint and return the successful result', async () => {
    const insert = jest
      .fn()
      .mockRejectedValueOnce(collision())
      .mockResolvedValue('saved');
    const generate = jest
      .fn()
      .mockReturnValueOnce('aaaaaaaaaaaa')
      .mockReturnValueOnce('bbbbbbbbbbbb');
    expect(await reservePublicId(insert, generate)).toBe('saved');
    expect(insert.mock.calls).toEqual([['aaaaaaaaaaaa'], ['bbbbbbbbbbbb']]);
  });

  it('should stop after three total colliding inserts', async () => {
    const insert = jest.fn().mockRejectedValue(collision());
    await expect(
      reservePublicId(insert, () => 'aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_ID_ALLOCATION_FAILED' });
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it.each([
    collision('other_unique'),
    collision('UQ_videos_public_id', '23503'),
    new Error('unexpected'),
  ])('should propagate unrelated errors without retrying', async (error) => {
    const insert = jest.fn().mockRejectedValue(error);
    await expect(reservePublicId(insert, () => 'aaaaaaaaaaaa')).rejects.toBe(
      error,
    );
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
