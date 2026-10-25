import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface VideoTestMedia {
  directory: string;
  validVideoPath: string;
  invalidVideoPath: string;
  cleanup: () => Promise<void>;
}

export async function createVideoTestMedia(): Promise<VideoTestMedia> {
  const directory = await mkdtemp(join(tmpdir(), 'streamtube-video-test-'));
  const validVideoPath = join(directory, 'valid.mp4');
  const invalidVideoPath = join(directory, 'invalid.mp4');
  const cleanup = async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await run(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=160x90:r=5',
        '-t',
        '1',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        validVideoPath,
      ],
      { timeout: 30000, maxBuffer: 64 * 1024 },
    );
    await writeFile(invalidVideoPath, 'This fixture is not a video.');
    return { directory, validVideoPath, invalidVideoPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
