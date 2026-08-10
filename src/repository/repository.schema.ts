import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Enum keeps status values consistent — no typos like "Indexing" vs "indexing"
export enum IngestionStatus {
  INDEXING = 'indexing',
  READY = 'ready',
  FAILED = 'failed',
}

@Schema({ timestamps: true }) // auto-adds createdAt and updatedAt fields
export class Repository {
  @Prop({ required: true })
  repoUrl: string;

  @Prop({ required: true, unique: true })
  repoId: string; // "jahio-hello-world-node-express" — also the Qdrant collection name

  @Prop({ required: true })
  owner: string;

  @Prop({ required: true })
  repo: string;

  @Prop({ enum: IngestionStatus, default: IngestionStatus.INDEXING })
  status: IngestionStatus;

  @Prop({ default: 0 })
  fileCount: number;

  @Prop({ default: 0 })
  chunkCount: number;

  @Prop()
  errorMessage?: string;
}

export type RepositoryDocument = Repository & Document;
export const RepositorySchema = SchemaFactory.createForClass(Repository);