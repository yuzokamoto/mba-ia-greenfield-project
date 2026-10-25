import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, type Socket } from 'node:net';
import storageConfig from '../../config/storage.config';

@Injectable()
export class MediaSourceService implements OnModuleDestroy {
  private readonly closing = new Set<() => Promise<void>>();
  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async open(signedUrl: string, timeoutMs: number) {
    const target = new URL(signedUrl);
    if (
      target.origin !== new URL(this.config.internalEndpoint).origin ||
      target.username ||
      target.password
    )
      throw new Error(
        'Media source must use the configured internal storage origin',
      );
    const sockets = new Set<Socket>();
    let unavailable = false;
    let blocked = false;
    const server = createServer((incoming, outgoing) => {
      if (incoming.method !== 'GET' || incoming.url !== signedUrl) {
        blocked = true;
        outgoing.writeHead(403).end();
        return;
      }
      const remote = (
        target.protocol === 'https:' ? httpsRequest : httpRequest
      )(
        target,
        {
          method: 'GET',
          headers: incoming.headers.range
            ? { range: incoming.headers.range }
            : {},
          timeout: timeoutMs,
        },
        (response) => {
          if (
            (response.statusCode ?? 500) >= 400 &&
            response.statusCode !== 416
          )
            unavailable = true;
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      remote.once('timeout', () => remote.destroy());
      remote.once('error', () => {
        unavailable = true;
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      outgoing.once('close', () => remote.destroy());
      remote.end();
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.on('connect', (request, client, head) => {
      if (
        target.protocol !== 'https:' ||
        request.url !== `${target.hostname}:${target.port || '443'}`
      ) {
        blocked = true;
        client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      const upstream = connect(
        Number(target.port || 443),
        target.hostname,
        () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          client.pipe(upstream);
          upstream.pipe(client);
        },
      );
      sockets.add(upstream);
      upstream.once('close', () => sockets.delete(upstream));
      upstream.once('error', () => {
        unavailable = true;
        client.destroy();
      });
      client.once('close', () => upstream.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Media proxy did not bind');
    let closed: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closed ??= new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      });
      this.closing.delete(close);
      return closed;
    };
    this.closing.add(close);
    return {
      proxy: `http://127.0.0.1:${address.port}`,
      unavailable: () => unavailable,
      blocked: () => blocked,
      close,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.closing].map((close) => close()));
  }
}
