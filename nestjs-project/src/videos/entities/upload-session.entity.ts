import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { Video } from './video.entity';

export enum UploadSessionStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ABORTED = 'aborted',
  EXPIRED = 'expired',
}

@Entity('upload_sessions')
@Index('IDX_upload_sessions_status_expires', ['status', 'expires_at'])
@Check('CHK_upload_sessions_part_size', '"part_size" > 0')
export class UploadSession {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) video_id: string;
  @Column({ type: 'text' }) upload_id: string;
  @Column({
    type: 'enum',
    enum: UploadSessionStatus,
    default: UploadSessionStatus.ACTIVE,
  })
  status: UploadSessionStatus;
  @Column({ type: 'integer' }) part_size: number;
  @Column({ type: 'timestamp' }) expires_at: Date;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;

  @OneToOne(() => Video, (video) => video.upload_session, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({ name: 'video_id' })
  video: Relation<Video>;
}
