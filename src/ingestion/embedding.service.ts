import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { Document } from '@langchain/core/documents';
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { randomUUID } from 'crypto';

// One search result: the matched chunk + its similarity score
export interface SearchResult {
  content: string;
  score: number;
  metadata: Record<string, any>;
}

@Injectable()
export class EmbeddingService implements OnModuleInit {
    private readonly logger = new Logger(EmbeddingService.name);
    private qdrantClient!: QdrantClient;
    private embedder!: FeatureExtractionPipeline;
    private readonly VECTOR_SIZE = 384;
    constructor(private configService: ConfigService) {}

    // Runs once when the NestJS module loads.
    // Loading the model here (not per-request) means the ~90MB download and model warmup only happens once for the app's lifetime.
    async onModuleInit() {
        this.qdrantClient = new QdrantClient({
            url: this.configService.get<string>('QDRANT_URL') || 'http://localhost:6333',
            apiKey: this.configService.get<string>('QDRANT_API_KEY') || undefined,
        });

        this.logger.log('Loading local embedding model (first run downloads ~90MB)...');
        this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        this.logger.log('✅ Embedding model ready (Xenova/all-MiniLM-L6-v2, 384-dim)');
    }


    // Convert a single piece of text into a 384-number vector.
    // Used both for embedding chunks (ingestion) and embedding questions (retrieval)
    async embedText(text: string): Promise<number[]> {
        const output = await this.embedder(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data as Float32Array);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const vectors: number[][] = [];
        for (let i = 0; i < texts.length; i++) {
            vectors.push(await this.embedText(texts[i]));
            if ((i + 1) % 20 === 0) {
                this.logger.log(`Embedded ${i + 1}/${texts.length} chunks...`);
            }
        }
        return vectors;
    }

    // Create a fresh Qdrant collection for a repo.
    // If one already exists (re-indexing), delete and recreate it
    async createCollection(repoId: string): Promise<void> {
        const collections = await this.qdrantClient.getCollections();
        const exists = collections.collections.some((c) => c.name === repoId);

        if (exists) {
            this.logger.log(`Collection "${repoId}" exists — recreating`);
            await this.qdrantClient.deleteCollection(repoId);
        }

        await this.qdrantClient.createCollection(repoId, {
            vectors: {
                size: this.VECTOR_SIZE,
                distance: 'Cosine', // best choice for semantic/text similarity
            },
        });

        this.logger.log(`✅ Created Qdrant collection: "${repoId}"`);
    }


    // THE CORE STEP: take LangChain Documents (text + metadata),
    // embed each one locally, and upsert them into Qdrant as "points".
    // A Qdrant point = { id, vector, payload }
    // payload holds the original text + metadata so we can read it back
    // later without needing a separate database lookup.
    async embedAndStore(documents: Document[], repoId: string): Promise<void> {
        this.logger.log(`Embedding ${documents.length} chunks for "${repoId}"...`);

        const texts = documents.map((doc) => doc.pageContent);
        const vectors = await this.embedBatch(texts);

        const points = documents.map((doc, i) => ({
            id: randomUUID(),
            vector: vectors[i],
            payload: {
                pageContent: doc.pageContent,
                ...doc.metadata,
            },
        }));

        // Upsert in batches of 100 — avoids one giant request that could time out
        const BATCH_SIZE = 100;
        for (let i = 0; i < points.length; i += BATCH_SIZE) {
            const batch = points.slice(i, i + BATCH_SIZE);
            await this.qdrantClient.upsert(repoId, { points: batch, wait: true });
        }

        this.logger.log(`✅ Stored ${points.length} vectors in Qdrant`);
    }


    // Given a question, find the most similar chunks in a repo's collection.
    // This is the "R" (Retrieval) in RAG
    async similaritySearch(
        query: string,
        repoId: string,
        topK: number = 5
    ): Promise<SearchResult[]> {
        const queryVector = await this.embedText(query);

        const response = await this.qdrantClient.query(repoId, {
            query: queryVector,
            limit: topK,
            with_payload: true,
        });

        return response.points.map((result) => ({
            content: (result.payload as any).pageContent,
            score: result.score, // cosine similarity, 0 to 1 — higher is more relevant
            metadata: {
                source: (result.payload as any).source,
                repoId: (result.payload as any).repoId,
                chunkIndex: (result.payload as any).chunkIndex,
            },
        }));
    }


    async collectionExists(repoId: string): Promise<boolean> {
        const collections = await this.qdrantClient.getCollections();
        return collections.collections.some((c) => c.name === repoId);
    }

    async getCollectionInfo(repoId: string) {
        return this.qdrantClient.getCollection(repoId);
    }

    async deleteCollection(repoId: string): Promise<void> {
        await this.qdrantClient.deleteCollection(repoId);
        this.logger.log(`Deleted collection: "${repoId}"`);
    }
}