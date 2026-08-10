/**
 * MCP Server for DevDocs AI
 *
 * This is a STANDALONE process — separate from your NestJS app.
 * Claude Desktop launches this file directly and communicates with it
 * over stdio.
 */

/**
 * CRITICAL: MCP over stdio requires stdout to contain ONLY JSON-RPC
 * protocol messages. Multiple sources can pollute it — NestJS's Logger,
 * dotenv's startup banner, and (as observed) something inside the
 * Xenova/transformers model-loading chain, roughly 10-12 seconds into
 * startup. Rather than hunt down every individual source, this filters
 * stdout directly: any write that isn't valid JSON gets redirected to
 * stderr instead of corrupting the protocol stream. This must be the
 * very first thing that runs, before any other import can write to stdout.
 */
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: any, ...args: any[]) => {
  const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  const trimmed = str.trim();
  if (trimmed.startsWith('{')) {
    return originalStdoutWrite(chunk, ...args);
  }
  process.stderr.write(chunk, ...args);
  return true;
}) as typeof process.stdout.write;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import * as path from 'path';

import { GithubService } from '../ingestion/github.service';
import { ChunkingService } from '../ingestion/chunking.service';
import { EmbeddingService } from '../ingestion/embedding.service';
import { RetrievalService } from '../retrieval/retrieval.service';

Logger.overrideLogger(false);

require('dotenv').config({
  path: path.join(__dirname, '../../.env'),
  debug: false,
});

console.error('GROQ_API_KEY loaded:', !!process.env.GROQ_API_KEY);
console.error('GITHUB_TOKEN loaded:', !!process.env.GITHUB_TOKEN);
console.error('Current working directory:', process.cwd());

async function main() {
  const configService = new ConfigService();
  const githubService = new GithubService(configService);
  const chunkingService = new ChunkingService();
  const embeddingService = new EmbeddingService(configService);
  await embeddingService.onModuleInit();

  const retrievalService = new RetrievalService(configService, embeddingService);

  const server = new McpServer({
    name: 'devdocs-ai',
    version: '1.0.0',
  });

  server.tool(
    'index_repository',
    'Index a GitHub repository so its codebase can be queried. Fetches all supported source files, splits them into chunks, and stores embeddings for semantic search.',
    {
      repoUrl: z.string().describe('The full GitHub repository URL, e.g. https://github.com/owner/repo'),
    },
    async ({ repoUrl }) => {
      try {
        const { owner, repo, repoId } = githubService.parseRepoUrl(repoUrl);

        const filePaths = await githubService.fetchFileTree(owner, repo);
        const files = await githubService.fetchAllFiles(owner, repo, filePaths);
        const chunks = await chunkingService.chunkFiles(files, repoId, repoUrl);

        await embeddingService.createCollection(repoId);
        await embeddingService.embedAndStore(chunks, repoId);

        return {
          content: [
            {
              type: 'text',
              text: `✅ Indexed "${repoUrl}" successfully.\n\nrepoId: ${repoId}\nFiles processed: ${files.length}\nChunks created: ${chunks.length}\n\nYou can now ask questions about this codebase using repoId "${repoId}".`,
            },
          ],
        };
      } catch (error: any) {
        console.error('index_repository error (full):', error);
        return {
          content: [{ type: 'text', text: `❌ Failed to index repository: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'query_codebase',
    'Ask a natural language question about a previously indexed GitHub repository. Returns an answer grounded in the actual code, with source file citations.',
    {
      question: z.string().describe('The question to ask about the codebase'),
      repoId: z.string().describe('The repoId returned when the repository was indexed, e.g. "owner-repo"'),
    },
    async ({ question, repoId }) => {
      try {
        const result = await retrievalService.query(question, repoId);

        const sourcesText = result.sources.length > 0
          ? `\n\n📎 Sources: ${result.sources.join(', ')}`
          : '';

        return {
          content: [{ type: 'text', text: `${result.answer}${sourcesText}` }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `❌ Failed to query codebase: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('DevDocs AI MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error starting MCP server:', error);
  process.exit(1);
});