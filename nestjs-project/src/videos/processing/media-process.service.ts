import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { MediaProcessError } from './media.errors';

@Injectable()
export class MediaProcessService implements OnModuleDestroy {
  private readonly children = new Map<
    ChildProcessWithoutNullStreams,
    { done: Promise<void>; stop: () => void }
  >();
  private stopping = false;

  async run(
    command: 'ffmpeg' | 'ffprobe',
    args: string[],
    timeoutMs: number,
    maximumBytes: number,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<Buffer> {
    if (this.stopping) throw new MediaProcessError('shutdown');
    if (timeoutMs <= 0) throw new MediaProcessError('timeout');
    const child = spawn(command, args, { shell: false, env, stdio: 'pipe' });
    child.stdin.end();
    let finished!: () => void;
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    let reason: MediaProcessError['reason'] | undefined;
    const stop = () => {
      reason = 'shutdown';
      child.kill('SIGKILL');
    };
    this.children.set(child, { done, stop });
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        const timer = setTimeout(() => {
          reason = 'timeout';
          child.kill('SIGKILL');
        }, timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maximumBytes) {
            reason = 'output';
            child.kill('SIGKILL');
          } else chunks.push(chunk);
        });
        // Drain diagnostics without retaining signed URLs or input-controlled text.
        child.stderr.on('data', () => undefined);
        child.once('error', () => {
          reason = 'spawn';
        });
        child.once('close', (code) => {
          clearTimeout(timer);
          const diagnostic = `Media process exit code: ${code ?? 'none'}`;
          if (reason || code !== 0)
            reject(new MediaProcessError(reason ?? 'exit', diagnostic));
          else resolve(Buffer.concat(chunks));
        });
      });
    } finally {
      this.children.delete(child);
      finished();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    const running = [...this.children.values()];
    for (const child of running) child.stop();
    await Promise.all(running.map((child) => child.done));
  }
}
