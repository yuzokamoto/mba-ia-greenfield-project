import type { DataSource } from 'typeorm';
import { withVideoMaintenanceLock } from './video-maintenance-lock';

describe('Video maintenance gate', () => {
  const runner = {
    connect: jest.fn(),
    query: jest.fn(),
    release: jest.fn(),
  };
  const source = {
    createQueryRunner: () => runner,
  } as unknown as DataSource;
  beforeEach(() => jest.resetAllMocks());

  it('should skip maintenance while exclusive fixture work holds the gate', async () => {
    runner.query.mockResolvedValue([{ locked: false }]);
    const action = jest.fn();
    await withVideoMaintenanceLock(source, action);
    expect(action).not.toHaveBeenCalled();
    expect(runner.query).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('should hold the gate until maintenance completes and release it on failure', async () => {
    runner.query.mockResolvedValue([{ locked: true }]);
    const failure = new Error('maintenance failed');
    await expect(
      withVideoMaintenanceLock(source, () => {
        expect(runner.query).toHaveBeenCalledTimes(1);
        expect(runner.release).not.toHaveBeenCalled();
        return Promise.reject(failure);
      }),
    ).rejects.toThrow(failure);
    expect(runner.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock_shared($1)',
      [730319],
    );
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
});
