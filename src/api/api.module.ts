import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { IngestionModule } from '../ingestion/ingestion.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { RepositoryModule } from '../repository/repository.module';

@Module({
  imports: [IngestionModule, RetrievalModule, RepositoryModule],
  controllers: [ApiController],
})
export class ApiModule {}