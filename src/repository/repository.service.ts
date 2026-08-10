import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Repository, RepositoryDocument, IngestionStatus } from './repository.schema';

@Injectable()
export class RepositoryService {
  constructor(
    @InjectModel(Repository.name)
    private repositoryModel: Model<RepositoryDocument>,
  ) {}

  /**
   * Create a new repo record, or update it if repoId already exists
   * (handles re-indexing the same repo without creating duplicates)
   */
  async createOrUpdate(data: Partial<Repository>): Promise<RepositoryDocument> {
    const result = await this.repositoryModel.findOneAndUpdate(
      { repoId: data.repoId },
      { $set: data },
      { upsert: true, new: true },
    );
    if (!result) {
      throw new Error(`Failed to create or update repository "${data.repoId}"`);
    }
    return result;
  }

  async updateStatus(
    repoId: string,
    status: IngestionStatus,
    extra?: { fileCount?: number; chunkCount?: number; errorMessage?: string },
  ): Promise<RepositoryDocument> {
    const result = await this.repositoryModel.findOneAndUpdate(
      { repoId },
      { $set: { status, ...extra } },
      { new: true },
    );
    if (!result) {
      throw new NotFoundException(`Repository "${repoId}" not found`);
    }
    return result;
  }

  async findById(repoId: string): Promise<RepositoryDocument> {
    const repo = await this.repositoryModel.findOne({ repoId });
    if (!repo) {
      throw new NotFoundException(`Repository "${repoId}" not found`);
    }
    return repo;
  }

  async findAll(): Promise<RepositoryDocument[]> {
    return this.repositoryModel.find().sort({ createdAt: -1 });
  }

  async delete(repoId: string): Promise<void> {
    const result = await this.repositoryModel.deleteOne({ repoId });
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Repository "${repoId}" not found`);
    }
  }
}