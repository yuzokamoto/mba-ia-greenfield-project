import { readFileSync, unlinkSync } from 'node:fs';
import type { OpenAPIObject } from '@nestjs/swagger';
import type {
  ResponseObject,
  SchemaObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from 'node:http';
import { ModulesContainer } from '@nestjs/core';
import { exportSpec } from './openapi-export';
import * as swaggerDocument from './swagger/swagger-document';
import { VideoProcessor } from './videos/processing/video.processor';
import { VideoReconcilerService } from './videos/processing/video-reconciler.service';
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_PART_SIZE_BYTES,
} from './videos/videos.constants';

describe('exportSpec (integration)', () => {
  let outputPath: string;
  let document: OpenAPIObject;
  let listenerStarted = false;
  let workerRegistered = false;

  beforeAll(async () => {
    outputPath = join(tmpdir(), `openapi-test-${Date.now()}.json`);
    jest.spyOn(Server.prototype, 'listen').mockImplementation(() => {
      listenerStarted = true;
      throw new Error('Offline export must not listen');
    });
    const buildDocument = swaggerDocument.buildSwaggerDocument;
    const spy = jest.spyOn(swaggerDocument, 'buildSwaggerDocument');
    spy.mockImplementation((app) => {
      const modules = app.get(ModulesContainer);
      for (const module of modules.values()) {
        workerRegistered ||=
          module.providers.has(VideoProcessor) ||
          module.providers.has(VideoReconcilerService);
      }
      return buildDocument(app);
    });
    try {
      await exportSpec(outputPath);
      document = JSON.parse(readFileSync(outputPath, 'utf-8')) as OpenAPIObject;
    } finally {
      jest.restoreAllMocks();
    }
  }, 30_000);

  afterAll(() => unlinkSync(outputPath));

  it('exports without an HTTP listener, consumer or reconciliation timer', () => {
    expect(listenerStarted).toBe(false);
    expect(workerRegistered).toBe(false);
  });

  it('matches the tracked export for every video path and schema', () => {
    const tracked = JSON.parse(
      readFileSync('openapi.json', 'utf-8'),
    ) as OpenAPIObject;
    for (const [path, methods] of Object.entries(document.paths)) {
      if (path.startsWith('/videos'))
        expect(tracked.paths[path]).toEqual(methods);
    }
    for (const [name, value] of Object.entries(document.components!.schemas!)) {
      expect(tracked.components!.schemas![name]).toEqual(value);
    }
  });

  it('exports all nine video operations with exact status, bearer and native 401 contracts', () => {
    const contracts = [
      [
        '/videos/uploads',
        'post',
        ['201', '400', '401', '404', '429', '500', '503'],
      ],
      [
        '/videos/{publicId}/upload/parts',
        'post',
        ['200', '400', '401', '404', '409', '429', '503'],
      ],
      [
        '/videos/{publicId}/upload/parts',
        'get',
        ['200', '400', '401', '404', '409', '429', '503'],
      ],
      [
        '/videos/{publicId}/upload/complete',
        'post',
        ['202', '400', '401', '404', '409', '429', '503'],
      ],
      [
        '/videos/{publicId}/upload/abort',
        'post',
        ['204', '400', '401', '404', '409', '429', '503'],
      ],
      ['/videos/{publicId}', 'get', ['200', '400', '401', '404', '429']],
      ['/videos', 'get', ['200', '401', '429']],
      [
        '/videos/{publicId}/playback-url',
        'get',
        ['200', '400', '401', '404', '409', '429', '503'],
      ],
      [
        '/videos/{publicId}/download-url',
        'get',
        ['200', '400', '401', '404', '409', '429', '503'],
      ],
    ] as const;
    for (const [path, method, statuses] of contracts) {
      const operation = document.paths[path][method]!;
      expect(Object.keys(operation.responses).sort()).toEqual(
        [...statuses].sort(),
      );
      expect(operation.security).toEqual([{ 'access-token': [] }]);
      expect(operation.summary).toBeTruthy();
      const unauthorized = operation.responses['401'] as ResponseObject;
      expect(unauthorized.content!['application/json'].schema).toEqual({
        type: 'object',
        required: ['message', 'statusCode'],
        properties: {
          message: { type: 'string', example: 'Unauthorized' },
          statusCode: { type: 'integer', example: 401 },
        },
      });
      if (path.includes('{publicId}')) {
        expect(operation.parameters).toContainEqual(
          expect.objectContaining({
            name: 'publicId',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{12}$' },
          }),
        );
      }
      for (const status of statuses.filter((value) =>
        ['400', '404', '409', '500', '503'].includes(value),
      )) {
        const response = operation.responses[status] as ResponseObject;
        const json = response.content!['application/json'];
        expect(json.schema).toEqual({
          $ref: '#/components/schemas/ApiErrorEnvelope',
        });
        expect(Object.keys(json.examples!)).not.toHaveLength(0);
      }
    }
    const abort = document.paths['/videos/{publicId}/upload/abort'].post!;
    expect((abort.responses['204'] as ResponseObject).content).toBeUndefined();
  });

  it('exports complete request models, exact byte bounds and nested response models', () => {
    const schemas = document.components!.schemas!;
    const schema = (name: string) => schemas[name] as SchemaObject;
    expect(schema('StartVideoUploadDto').required).toEqual(
      expect.arrayContaining([
        'title',
        'original_filename',
        'content_type',
        'declared_size',
      ]),
    );
    for (const field of ['title', 'original_filename', 'content_type']) {
      expect(schema('StartVideoUploadDto').properties![field]).toMatchObject({
        type: 'string',
        minLength: 1,
      });
    }
    expect(
      schema('StartVideoUploadDto').properties!.declared_size,
    ).toMatchObject({
      type: 'integer',
      format: 'int64',
      minimum: 1,
      maximum: UPLOAD_MAX_BYTES,
    });
    expect(schema('CompleteVideoUploadPartDto').required).toEqual([
      'part_number',
      'etag',
    ]);
    expect(
      schema('CompleteVideoUploadPartDto').properties!.part_number,
    ).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: Math.ceil(UPLOAD_MAX_BYTES / UPLOAD_PART_SIZE_BYTES),
    });
    expect(schema('CompleteVideoUploadPartDto').properties!.etag).toMatchObject(
      { type: 'string', minLength: 1 },
    );
    expect(schema('CompleteVideoUploadDto').properties!.parts).toMatchObject({
      minItems: 1,
      maxItems: 160,
      uniqueItems: true,
      items: { $ref: '#/components/schemas/CompleteVideoUploadPartDto' },
    });
    expect(schema('SignUploadPartsDto').properties!.part_numbers).toMatchObject(
      {
        minItems: 1,
        maxItems: 160,
        uniqueItems: true,
        items: { type: 'integer', minimum: 1, maximum: 160 },
      },
    );
    for (const name of ['StartVideoUploadResponseDto', 'OwnVideoResponseDto']) {
      expect(schema(name).properties).toEqual({
        video: { $ref: '#/components/schemas/VideoResponseDto' },
        upload_session: {
          $ref: '#/components/schemas/UploadSessionResponseDto',
        },
      });
    }
    expect(
      schema('ListUploadedPartsResponseDto').properties!.parts,
    ).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/UploadedPartDto' },
    });
    expect(
      schema('SignUploadPartsResponseDto').properties!.parts,
    ).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/SignedUploadPartDto' },
    });
    expect(schema('SignedUrlResponseDto').properties).toEqual({
      url: { type: 'string', format: 'uri' },
      expires_at: { type: 'string', format: 'date-time' },
    });
  });

  it('exports a valid OpenAPI 3.x document', () => {
    expect(document.openapi).toMatch(/^3\./);
  });

  it('sets info.title to "StreamTube API"', () => {
    const info = document.info;
    expect(info.title).toBe('StreamTube API');
  });

  it('sets info.version to "1.0"', () => {
    const info = document.info;
    expect(info.version).toBe('1.0');
  });

  it('includes access-token Bearer security scheme', () => {
    const components = document.components as Record<string, unknown>;
    const schemes = components.securitySchemes as Record<
      string,
      Record<string, unknown>
    >;
    expect(schemes['access-token']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('includes non-empty components.schemas from DTO inference', () => {
    const components = document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    expect(Object.keys(schemas).length).toBeGreaterThan(0);
  });

  it('includes ApiErrorEnvelope schema with expected properties', () => {
    const components = document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<
      string,
      Record<string, unknown>
    >;
    expect(schemas['ApiErrorEnvelope']).toBeDefined();
    const props = schemas['ApiErrorEnvelope'].properties as Record<
      string,
      unknown
    >;
    expect(props).toHaveProperty('statusCode');
    expect(props).toHaveProperty('error');
    expect(props).toHaveProperty('message');
    expect(props).toHaveProperty('code');
  });

  it('has at least one path with a 401 response referencing ApiErrorEnvelope', () => {
    const paths = document.paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const apiErrorRef = '#/components/schemas/ApiErrorEnvelope';

    const hasRef = Object.values(paths).some((methods) =>
      Object.values(methods).some((operation) => {
        const responses = operation.responses as Record<
          string,
          Record<string, unknown>
        >;
        const r401 = responses?.['401'];
        if (!r401) return false;
        const content = r401.content as Record<string, Record<string, unknown>>;
        const jsonContent = content?.['application/json'];
        const schema = jsonContent?.schema as Record<string, unknown>;
        return schema?.['$ref'] === apiErrorRef;
      }),
    );

    expect(hasRef).toBe(true);
  });

  it('protected auth endpoints include access-token security requirement', () => {
    const paths = document.paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const protectedPaths = [
      { path: '/auth/logout', method: 'post' },
      { path: '/auth/me', method: 'get' },
    ];

    for (const { path, method } of protectedPaths) {
      const operation = paths[path]?.[method];
      expect(operation).toBeDefined();
      const security = operation?.security as Array<Record<string, unknown>>;
      expect(security).toBeDefined();
      expect(security.some((req) => 'access-token' in req)).toBe(true);
    }
  });

  it('all auth endpoints have a non-empty summary', () => {
    const paths = document.paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const authPaths = Object.entries(paths).filter(([p]) =>
      p.startsWith('/auth/'),
    );

    expect(authPaths.length).toBeGreaterThan(0);

    for (const [, methods] of authPaths) {
      for (const operation of Object.values(methods)) {
        expect(typeof operation.summary).toBe('string');
        expect((operation.summary as string).length).toBeGreaterThan(0);
      }
    }
  });
});
