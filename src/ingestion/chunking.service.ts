import { Injectable, Logger } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import { RepoFile } from './github.service';

@Injectable()
export class ChunkingService {
    private readonly logger = new Logger(ChunkingService.name);
    private readonly CHUNK_SIZE = 800;
    private readonly CHUNK_OVERLAP = 150;

    private readonly splitter = new RecursiveCharacterTextSplitter({
        chunkSize: this.CHUNK_SIZE,
        chunkOverlap: this.CHUNK_OVERLAP,
        separators: ['\n\n', '\n', ' ', ''],
    });

    // Convert an array of repo files into an array of LangChain Documents.
    // Each Document = { pageContent: string, metadata: {...} }
    async chunkFiles(files: RepoFile[], repoId: string, repoUrl: string): Promise<Document[]> {
        this.logger.log(`Chunking ${files.length} files...`);
        const allChunks: Document[] = [];

        for (const file of files) {
            const chunks = await this.chunkSingleFile(file, repoId, repoUrl);
            allChunks.push(...chunks);
        }

        this.logger.log(`Created ${allChunks.length} total chunks from ${files.length} files`);
        return allChunks;
    }

    private async chunkSingleFile(
        file: RepoFile,
        repoId: string,
        repoUrl: string
    ): Promise<Document[]> {
        // Prefix with the file path so the LLM knows exactly where each chunk
        // came from — this is what lets it cite "src/auth/auth.service.ts" later.
        const contentWithHeader = `// File: ${file.path}\n\n${file.content}`;

        const chunks = await this.splitter.splitText(contentWithHeader);

        return chunks.map((chunk, index) => ({
            pageContent: chunk,
            metadata: {
                source: file.path,
                repoId,
                repoUrl,
                chunkIndex: index,
                totalChunks: chunks.length,
                fileExtension: this.getExtension(file.path),
                fileSize: file.size,
            },
        }));
    }

    private getExtension(filePath: string): string {
        const parts = filePath.split('.');
        return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
    }
}