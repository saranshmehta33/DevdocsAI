import { Injectable, Logger } from '@nestjs/common';
import { GithubService } from './github.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { RepositoryService } from '../repository/repository.service';
import { IngestionStatus } from '../repository/repository.schema';

export interface IngestionResult {
  repoId: string;
  repoUrl: string;
  fileCount: number;
  chunkCount: number;
  status: 'ready' | 'failed';
  errorMessage?: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private githubService: GithubService,
    private chunkingService: ChunkingService,
    private embeddingService: EmbeddingService,
    private repositoryService: RepositoryService,
  ) {}

  /**
   * FULL PIPELINE — called by both the REST API and the MCP server.
   * 1. Parse URL          2. Save "indexing" status to MongoDB
   * 3. Fetch file tree    4. Fetch file contents
   * 5. Chunk files        6. Create Qdrant collection
   * 7. Embed + store      8. Update MongoDB status to "ready"
   */
  async ingestRepository(repoUrl: string): Promise<IngestionResult> {
    const { owner, repo, repoId } = this.githubService.parseRepoUrl(repoUrl);
    this.logger.log(`Starting ingestion for ${owner}/${repo} (id: ${repoId})`);

    await this.repositoryService.createOrUpdate({
      repoUrl,
      repoId,
      owner,
      repo,
      status: IngestionStatus.INDEXING,
      fileCount: 0,
      chunkCount: 0,
    });

    try {
      const filePaths = await this.githubService.fetchFileTree(owner, repo);
      if (filePaths.length === 0) {
        throw new Error('No supported files found in repository');
      }

      const files = await this.githubService.fetchAllFiles(owner, repo, filePaths);
      const chunks = await this.chunkingService.chunkFiles(files, repoId, repoUrl);

      await this.embeddingService.createCollection(repoId);
      await this.embeddingService.embedAndStore(chunks, repoId);

      await this.repositoryService.updateStatus(repoId, IngestionStatus.READY, {
        fileCount: files.length,
        chunkCount: chunks.length,
      });

      this.logger.log(`Ingestion complete: ${files.length} files, ${chunks.length} chunks`);

      return {
        repoId,
        repoUrl,
        fileCount: files.length,
        chunkCount: chunks.length,
        status: 'ready',
      };
    } catch (error:any) {
      this.logger.error(`Ingestion failed for ${repoId}: ${error.message}`);
      await this.repositoryService.updateStatus(repoId, IngestionStatus.FAILED, {
        errorMessage: error.message,
      });

      return {
        repoId,
        repoUrl,
        fileCount: 0,
        chunkCount: 0,
        status: 'failed',
        errorMessage: error.message,
      };
    }
  }
}