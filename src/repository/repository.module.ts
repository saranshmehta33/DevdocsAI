import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Repository, RepositorySchema } from './repository.schema';
import { RepositoryService } from './repository.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Repository.name, schema: RepositorySchema }]),
  ],
  providers: [RepositoryService],
  exports: [RepositoryService], // exported so IngestionModule and ApiModule can use it
})
export class RepositoryModule {}