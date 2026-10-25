import { Test } from '@nestjs/testing';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import videoConfig from '../../config/video.config';
import { StorageService } from '../../storage/storage.service';
import { MediaInspectionService } from './media-inspection.service';
import { MediaProcessService } from './media-process.service';
import { MediaSourceService } from './media-source.service';
import { InvalidMediaError, MediaProcessError } from './media.errors';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

describe('MediaInspectionService', () => {
  const storage = { signInternalGet: jest.fn(), uploadJpeg: jest.fn() };
  const process = { run: jest.fn() };
  const close = jest.fn();
  const sources = { open: jest.fn() };
  let service: MediaInspectionService;
  const probe = {
    format: { duration: '0.2', format_name: 'matroska,webm' },
    streams: [
      { codec_type: 'video', codec_name: 'av1', width: 160, height: 90 },
    ],
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    close.mockResolvedValue(undefined);
    storage.signInternalGet.mockResolvedValue({
      url: 'http://minio:9000/known?signature=private',
    });
    storage.uploadJpeg.mockResolvedValue(undefined);
    sources.open.mockResolvedValue({
      proxy: 'http://127.0.0.1:1234',
      close,
      blocked: () => false,
      unavailable: () => false,
    });
    process.run
      .mockResolvedValueOnce(
        Buffer.from(
          ' D  mov,mp4 MOV\n D  hls HLS\n D  matroska,webm Matroska\n',
        ),
      )
      .mockResolvedValueOnce(Buffer.from(JSON.stringify(probe)))
      .mockResolvedValue(Buffer.from([255, 216, 255, 217]));
    const module = await Test.createTestingModule({
      providers: [
        MediaInspectionService,
        { provide: StorageService, useValue: storage },
        { provide: MediaProcessService, useValue: process },
        { provide: MediaSourceService, useValue: sources },
        { provide: videoConfig.KEY, useValue: { mediaTimeoutMs: 10000 } },
      ],
    }).compile();
    service = module.get(MediaInspectionService);
    await module.close();
  });
  it('should accept detected codecs without a browser allowlist and return safe bounded metadata', () => {
    expect(service.parseProbe(Buffer.from(JSON.stringify(probe)))).toEqual({
      duration: 0.2,
      metadata: {
        container: 'matroska,webm',
        video: { codec: 'av1', width: 160, height: 90 },
      },
    });
  });
  it.each([
    {},
    { format: { duration: '1' }, streams: [] },
    { ...probe, format: { duration: '0', format_name: 'mov' } },
    { ...probe, format: { duration: '-1', format_name: 'mov' } },
    { ...probe, format: { duration: 'Infinity', format_name: 'mov' } },
  ])('should reject invalid video/duration data %j', (value) => {
    expect(() =>
      service.parseProbe(Buffer.from(JSON.stringify(value))),
    ).toThrow(InvalidMediaError);
  });
  it('should use seekable signed input, reject reference demuxers and upload only one bounded JPEG', async () => {
    const result = await service.inspect('id', 'known-key');
    expect(result.thumbnailKey).toBe('videos/id/thumbnail.jpg');
    const calls = process.run.mock.calls as [
      string,
      string[],
      number,
      number,
      NodeJS.ProcessEnv?,
    ][];
    expect(calls[1][1]).toContain('mov,mp4,matroska,webm');
    expect(calls[1][1]).not.toContain('hls');
    expect(calls[2][1]).toEqual(
      expect.arrayContaining(['-ss', '0.1', '-frames:v', '1', 'pipe:1']),
    );
    expect(calls[2][4]?.no_proxy).toBe('');
    expect(storage.uploadJpeg).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('should retry an empty sought frame from the start of a short clip', async () => {
    process.run
      .mockReset()
      .mockResolvedValueOnce(Buffer.from(' D  mov MOV\n'))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify(probe)))
      .mockResolvedValueOnce(Buffer.alloc(0))
      .mockResolvedValueOnce(Buffer.from([255, 216, 255]));
    await service.inspect('id', 'known-key');
    const calls = process.run.mock.calls as [string, string[]][];
    expect(calls[3][1]).toEqual(expect.arrayContaining(['-ss', '0']));
  });
  it('should preserve timeouts as transient and close owned resources', async () => {
    process.run
      .mockReset()
      .mockResolvedValueOnce(Buffer.from(' D  mov MOV\n'))
      .mockRejectedValueOnce(new MediaProcessError('timeout'));
    await expect(service.inspect('id', 'known')).rejects.toMatchObject({
      reason: 'timeout',
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(storage.uploadJpeg).not.toHaveBeenCalled();
  });
});

describe('MediaProcessService', () => {
  let service: MediaProcessService;
  let child: EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: jest.Mock;
  };
  beforeEach(async () => {
    child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: jest.fn(() => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      }),
    });
    jest
      .mocked(spawn)
      .mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const module = await Test.createTestingModule({
      providers: [MediaProcessService],
    }).compile();
    service = module.get(MediaProcessService);
  });
  it('should kill timed-out subprocesses without exposing input diagnostics', async () => {
    const result = service.run('ffprobe', [], 1, 10);
    child.stderr.emit(
      'data',
      Buffer.from('http://minio/private?signature=secret'),
    );
    await expect(result).rejects.toMatchObject({ reason: 'timeout' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('should kill output overflow and bound retained output', async () => {
    const result = service.run('ffmpeg', [], 1000, 2);
    child.stdout.emit('data', Buffer.alloc(3));
    await expect(result).rejects.toMatchObject({ reason: 'output' });
  });
  it('should terminate and await every owned child on shutdown', async () => {
    const result = service.run('ffprobe', [], 1000, 10);
    const rejected = expect(result).rejects.toMatchObject({
      reason: 'shutdown',
    });
    await service.onModuleDestroy();
    await rejected;
    await expect(service.run('ffprobe', [], 1000, 10)).rejects.toMatchObject({
      reason: 'shutdown',
    });
  });
});
