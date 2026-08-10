import { Module } from '@nestjs/common';
import { RetrievalService } from './retrieval.service';
import { IngestionModule } from '../ingestion/ingestion.module';

@Module({
  imports: [IngestionModule], // for EmbeddingService
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}