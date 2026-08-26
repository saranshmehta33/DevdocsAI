import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { EmbeddingService, SearchResult } from '../ingestion/embedding.service';

export interface RagResponse {
  answer: string;
  sources: string[];        // unique list of file paths used to answer
  retrievedChunks: number;  // how many chunks were fed into the prompt
}

@Injectable()
export class RetrievalService {
    private readonly logger = new Logger(RetrievalService.name);
    private groq!: Groq;
    private readonly MODEL = 'openai/gpt-oss-120b';
    private readonly TOP_K = 5;

    constructor(
        private configService: ConfigService,
        private embeddingService: EmbeddingService
    ) {
        const apiKey = this.configService.get<string>('GROQ_API_KEY');
        if (!apiKey) {
            throw new Error('GROQ_API_KEY is not set in environment variables');
        }
        this.groq = new Groq({ apiKey });
    }

    // THE FULL RAG PIPELINE
    // Step 1: Retrieve — find chunks relevant to the question (Qdrant + local embeddings)
    // Step 2: Augment  — build a prompt that includes those chunks as context
    // Step 3: Generate — ask Groq's LLM to answer using ONLY that context
    async query(question: string, repoId: string): Promise<RagResponse> {
        this.logger.log(`Querying "${repoId}": "${question}"`);

        // ── Step 1: Retrieve ────────────────────────────────────────────────
        const chunks = await this.embeddingService.similaritySearch(
        question,
        repoId,
        this.TOP_K,
        );

        if (chunks.length === 0) {
        throw new NotFoundException(
            `No indexed content found for repo "${repoId}". Has it been ingested yet?`
        );
        }

        this.logger.log(`Retrieved ${chunks.length} relevant chunks`);

        // ── Step 2: Augment ──────────────────────────────────────────────────
        const context = this.buildContext(chunks);
        const prompt = this.buildPrompt(question, context);

        // ── Step 3: Generate ─────────────────────────────────────────────────
        const answer = await this.generateAnswer(prompt);

        // Collect the unique set of source files actually used, so the
        // answer can be traced back to real code — this is the "cited sources" feature
        const sources = [...new Set(chunks.map((c) => c.metadata.source))];

        return {
        answer,
        sources,
        retrievedChunks: chunks.length,
        };
    }

    // Turn retrieved chunks into a single context string for the prompt.
    // Each chunk is labeled with its source file so the LLM can cite it correctly.
    private buildContext(chunks: SearchResult[]): string {
        return chunks
        .map((chunk, i) => {
            return `[Chunk ${i + 1} — Source: ${chunk.metadata.source}]\n${chunk.content}`;
        })
        .join('\n\n---\n\n');
    }

    /**
     * The prompt is the most important part of RAG quality.
     * Key rules baked in here:
     * - Answer ONLY from provided context (prevents hallucination)
     * - Always cite the source file (this is the resume-worthy feature)
     * - Say so explicitly if the context doesn't contain the answer
     */
    private buildPrompt(question: string, context: string): string {
        return `You are an expert code assistant helping a developer understand a codebase.

        Answer the question below using ONLY the code context provided. Follow these rules:
        1. Base your answer strictly on the given context — do not use outside knowledge or guess.
        2. Always mention which file(s) your answer comes from, using the exact source paths shown.
        3. If the context does not contain enough information to answer, say so clearly instead of guessing.
        4. Keep the answer concise and technical, like an experienced engineer explaining to a teammate.

        CONTEXT:
        ${context}

        QUESTION:
        ${question}

        ANSWER:`;
    }

    /**
     * Send the prompt to Groq and return the generated text.
     * temperature: 0.2 keeps answers focused and factual rather than creative —
     * important for a code Q&A tool where accuracy matters more than variety.
     */
    private async generateAnswer(prompt: string): Promise<string> {
        const completion = await this.groq.chat.completions.create({
            model: this.MODEL,
            messages: [
                {
                role: 'system',
                content: 'You are a precise, source-citing codebase expert. Never invent information not present in the given context.',
                },
                {
                role: 'user',
                content: prompt,
                },
            ],
            temperature: 0.2,
            max_tokens: 1024,
        });

        return completion.choices[0]?.message?.content ?? 'No answer generated.';
    }
    
}