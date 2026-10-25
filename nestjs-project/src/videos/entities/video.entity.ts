import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { UPLOAD_MAX_BYTES } from '../videos.constants';
import { UploadSession } from './upload-session.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

export enum VideoFailureReason {
  INVALID_MEDIA = 'invalid_media',
  PROCESSING_FAILED = 'processing_failed',
  UPLOAD_EXPIRED = 'upload_expired',
}

@Entity('videos')
@Unique('UQ_videos_public_id', ['public_id'])
@Index('IDX_videos_channel_created', ['channel_id', 'created_at', 'id'])
@Index('IDX_videos_status_updated', ['status', 'updated_at'])
@Check('CHK_videos_public_id', `"public_id" ~ '^[A-Za-z0-9_-]{12}$'`)
@Check(
  'CHK_videos_declared_size',
  `"declared_size" >= 1 AND "declared_size" <= ${UPLOAD_MAX_BYTES}`,
)
@Check(
  'CHK_videos_duration',
  `"duration" IS NULL OR ("duration" > 0 AND "duration" < 'Infinity'::double precision)`,
)
@Check(
  'CHK_videos_attempts',
  '"processing_attempts" >= 0 AND "processing_attempts" <= 3',
)
@Check(
  'CHK_videos_failure_reason',
  `"failure_reason" IS NULL OR "failure_reason" IN ('invalid_media', 'processing_failed', 'upload_expired')`,
)
@Check(
  'CHK_videos_ready',
  `"status" <> 'ready' OR ("thumbnail_key" IS NOT NULL AND "duration" IS NOT NULL AND "metadata" IS NOT NULL AND "failure_reason" IS NULL)`,
)
export class Video {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) channel_id: string;
  @Column({ type: 'varchar', length: 12, update: false }) public_id: string;
  @Column({ type: 'text' }) title: string;
  @Column({
    type: 'enum',
    enum: VideoStatus,
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;
  @Column({ type: 'text', nullable: true })
  failure_reason: VideoFailureReason | null;
  @Column({ type: 'text' }) original_key: string;
  @Column({ type: 'text', nullable: true }) thumbnail_key: string | null;
  @Column({ type: 'text' }) original_filename: string;
  @Column({ type: 'text' }) content_type: string;
  @Column({ type: 'bigint' }) declared_size: string;
  @Column({ type: 'double precision', nullable: true }) duration: number | null;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<
    string,
    unknown
  > | null;
  @Column({ type: 'integer', default: 0 }) processing_attempts: number;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({ name: 'channel_id' })
  channel: Relation<Channel>;

  @OneToOne(() => UploadSession, (session) => session.video)
  upload_session: Relation<UploadSession>;
}
