import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { GithubService } from '../ingestion/github.service';
import { ChunkingService } from '../ingestion/chunking.service';
import { EmbeddingService } from '../ingestion/embedding.service';
import { RetrievalService } from './retrieval.service';

async function main() {
  const configService = new ConfigService();
  const githubService = new GithubService(configService);
  const chunkingService = new ChunkingService();
  const embeddingService = new EmbeddingService(configService);
  await embeddingService.onModuleInit();

  const retrievalService = new RetrievalService(configService, embeddingService);

  const testRepoUrl = 'https://github.com/jahio/hello-world-node-express';

  console.log(`\n🚀 Full RAG pipeline test with: ${testRepoUrl}\n`);

  // ── Ingest (Phases 2 + 3, already verified) ──────────────────────────
  const { owner, repo, repoId } = githubService.parseRepoUrl(testRepoUrl);
  const filePaths = await githubService.fetchFileTree(owner, repo);
  const files = await githubService.fetchAllFiles(owner, repo, filePaths);
  const chunks = await chunkingService.chunkFiles(files, repoId, testRepoUrl);
  await embeddingService.createCollection(repoId);
  await embeddingService.embedAndStore(chunks, repoId);
  console.log(`✅ Indexed ${chunks.length} chunks from ${files.length} files\n`);

  // ── Ask real questions (Phase 4, new) ────────────────────────────────
  const questions = [
    'How does this server respond to a request on the home route?',
    'What port does this application listen on?',
  ];

  for (const question of questions) {
    console.log('═'.repeat(70));
    console.log(`❓ Question: ${question}`);
    console.log('═'.repeat(70));

    const result = await retrievalService.query(question, repoId);

    console.log(`\n💬 Answer:\n${result.answer}\n`);
    console.log(`📎 Sources: ${result.sources.join(', ')}`);
    console.log(`🔍 Chunks used: ${result.retrievedChunks}\n`);
  }

  console.log('🎉 Phase 4 test complete — full RAG pipeline working end-to-end!\n');
}

main().catch((err) => {
  console.error('❌ Test failed:', err.message);
  console.error('\nCommon causes:');
  console.error('  - GROQ_API_KEY missing or invalid in .env');
  console.error('  - Qdrant not running → docker ps');
  process.exit(1);
});