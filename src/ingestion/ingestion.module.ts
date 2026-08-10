import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { GithubService } from './github.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { RepositoryModule } from '../repository/repository.module';

@Module({
  imports: [RepositoryModule],
  providers: [IngestionService, GithubService, ChunkingService, EmbeddingService],
  exports: [IngestionService, EmbeddingService], // EmbeddingService needed by RetrievalService too
})
export class IngestionModule {}