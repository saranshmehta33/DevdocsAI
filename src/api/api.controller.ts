import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    Param,
    HttpCode,
    HttpStatus,
    BadRequestException,
} from '@nestjs/common';
import { IngestionService } from '../ingestion/ingestion.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RepositoryService } from '../repository/repository.service';
import { EmbeddingService } from '../ingestion/embedding.service';
import { IndexRepoDto } from './dto/index-repo.dto';
import { QueryRepoDto } from './dto/query-repo.dto';

@Controller('repos')
export class ApiController {
    constructor(
        private ingestionService: IngestionService,
        private retrievalService: RetrievalService,
        private repositoryService: RepositoryService,
        private embeddingService: EmbeddingService,
    ) { }

    /**
     * POST /api/v1/repos/index
     *
     * Ingestion can take anywhere from seconds to minutes depending on repo
     * size, so this deliberately does NOT await the full pipeline — it fires
     * ingestion in the background and returns immediately with a repoId the
     * client can poll via GET /repos/:id/status.
     */
    @Post('index')
    @HttpCode(HttpStatus.ACCEPTED)
    async indexRepository(@Body() dto: IndexRepoDto) {
        // Fire and forget — errors are caught inside ingestRepository itself
        // and recorded as a "failed" status in MongoDB, so we don't need to
        // await or handle the promise rejection here.
        this.ingestionService.ingestRepository(dto.repoUrl).catch(() => {
            // Already logged and persisted inside ingestRepository — nothing more to do
        });

        // Parse just enough to return a repoId immediately
        const match = dto.repoUrl.match(/github\.com\/([^\/]+)\/([^\/\s\.]+)/);
        if (!match) {
            throw new BadRequestException(`Invalid GitHub URL: ${dto.repoUrl}`);
        }
        const repoId = `${match[1]}-${match[2]}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

        return {
            message: 'Indexing started',
            repoId,
            statusUrl: `/api/v1/repos/${repoId}/status`,
        };
    }

    /**
     * GET /api/v1/repos/:id/status
     * Poll this while indexing is in progress.
     */
    @Get(':id/status')
    async getStatus(@Param('id') repoId: string) {
        const repo = await this.repositoryService.findById(repoId);
        return {
            repoId: repo.repoId,
            repoUrl: repo.repoUrl,
            status: repo.status,
            fileCount: repo.fileCount,
            chunkCount: repo.chunkCount,
            errorMessage: repo.errorMessage,
        };
    }

    /**
     * POST /api/v1/repos/:id/query
     * Ask a question about an already-indexed repo.
     */
    @Post(':id/query')
    async queryRepository(@Param('id') repoId: string, @Body() dto: QueryRepoDto) {
        return this.retrievalService.query(dto.question, repoId);
    }

    /**
     * GET /api/v1/repos
     * List every repo that's been indexed (any status).
     */
    @Get()
    async listRepositories() {
        const repos = await this.repositoryService.findAll();
        return repos.map((repo) => ({
            repoId: repo.repoId,
            repoUrl: repo.repoUrl,
            status: repo.status,
            fileCount: repo.fileCount,
            chunkCount: repo.chunkCount,
            createdAt: (repo as any).createdAt,
        }));
    }

    /**
     * DELETE /api/v1/repos/:id
     * Removes both the MongoDB record and the Qdrant vector collection.
     */
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteRepository(@Param('id') repoId: string) {
        // Delete MongoDB record first — if this throws NotFoundException,
        // we never attempt the Qdrant delete on a repo that was never indexed.
        await this.repositoryService.delete(repoId);

        const exists = await this.embeddingService.collectionExists(repoId);
        if (exists) {
            await this.embeddingService.deleteCollection(repoId);
        }
    }
}