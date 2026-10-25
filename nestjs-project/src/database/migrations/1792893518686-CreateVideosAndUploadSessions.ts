import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideosAndUploadSessions1792893518686 implements MigrationInterface {
  name = 'CreateVideosAndUploadSessions1792893518686';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "public_id" character varying(12) NOT NULL, "title" text NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft', "failure_reason" text, "original_key" text NOT NULL, "thumbnail_key" text, "original_filename" text NOT NULL, "content_type" text NOT NULL, "declared_size" bigint NOT NULL, "duration" double precision, "metadata" jsonb, "processing_attempts" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_videos_public_id" UNIQUE ("public_id"), CONSTRAINT "CHK_videos_ready" CHECK ("status" <> 'ready' OR ("thumbnail_key" IS NOT NULL AND "duration" IS NOT NULL AND "metadata" IS NOT NULL AND "failure_reason" IS NULL)), CONSTRAINT "CHK_videos_failure_reason" CHECK ("failure_reason" IS NULL OR "failure_reason" IN ('invalid_media', 'processing_failed', 'upload_expired')), CONSTRAINT "CHK_videos_attempts" CHECK ("processing_attempts" >= 0 AND "processing_attempts" <= 3), CONSTRAINT "CHK_videos_duration" CHECK ("duration" IS NULL OR ("duration" > 0 AND "duration" < 'Infinity'::double precision)), CONSTRAINT "CHK_videos_declared_size" CHECK ("declared_size" >= 1 AND "declared_size" <= 10737418240), CONSTRAINT "CHK_videos_public_id" CHECK ("public_id" ~ '^[A-Za-z0-9_-]{12}$'), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status_updated" ON "videos" ("status", "updated_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_created" ON "videos" ("channel_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."upload_sessions_status_enum" AS ENUM('active', 'completed', 'aborted', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TABLE "upload_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "video_id" uuid NOT NULL, "upload_id" text NOT NULL, "status" "public"."upload_sessions_status_enum" NOT NULL DEFAULT 'active', "part_size" integer NOT NULL, "expires_at" TIMESTAMP NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_a0c9961c327fca4a5cfea37c5f" UNIQUE ("video_id"), CONSTRAINT "CHK_upload_sessions_part_size" CHECK ("part_size" > 0), CONSTRAINT "PK_4b6ca30b8bb2baa0de9c6bf8fea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_upload_sessions_status_expires" ON "upload_sessions" ("status", "expires_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "upload_sessions" ADD CONSTRAINT "FK_a0c9961c327fca4a5cfea37c5fb" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "upload_sessions" DROP CONSTRAINT "FK_a0c9961c327fca4a5cfea37c5fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_upload_sessions_status_expires"`,
    );
    await queryRunner.query(`DROP TABLE "upload_sessions"`);
    await queryRunner.query(`DROP TYPE "public"."upload_sessions_status_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_created"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_status_updated"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
