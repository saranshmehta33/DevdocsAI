import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { GithubService } from './github.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';

async function main() {
  const configService = new ConfigService();
  const githubService = new GithubService(configService);
  const chunkingService = new ChunkingService();
  const embeddingService = new EmbeddingService(configService);

  // Manually trigger the model loading step (normally NestJS calls this automatically)
  await embeddingService.onModuleInit();

  const testRepoUrl = 'https://github.com/jahio/hello-world-node-express';

  console.log(`\n🔍 Testing full pipeline with: ${testRepoUrl}\n`);

  // ── Fetch + Chunk (Phase 2, already verified) ──────────────────────
  const { owner, repo, repoId } = githubService.parseRepoUrl(testRepoUrl);
  const filePaths = await githubService.fetchFileTree(owner, repo);
  const files = await githubService.fetchAllFiles(owner, repo, filePaths);
  const chunks = await chunkingService.chunkFiles(files, repoId, testRepoUrl);
  console.log(`✅ Chunking done: ${chunks.length} chunks from ${files.length} files\n`);

  // ── Create Qdrant collection ─────────────────────────────────────────
  console.log('🗄️  Creating Qdrant collection...');
  await embeddingService.createCollection(repoId);

  // ── Embed + store (Phase 3, new) ─────────────────────────────────────
  console.log('🧠 Embedding chunks locally and storing in Qdrant...');
  await embeddingService.embedAndStore(chunks, repoId);

  // ── Verify storage worked ────────────────────────────────────────────
  const info = await embeddingService.getCollectionInfo(repoId);
  console.log(`\n✅ Qdrant collection now has ${info.points_count} vectors stored\n`);

  // ── Test similarity search ───────────────────────────────────────────
  const testQuery = 'how does the server respond to requests';
  console.log(`🔎 Searching for: "${testQuery}"\n`);

  const results = await embeddingService.similaritySearch(testQuery, repoId, 3);

  console.log(`Found ${results.length} relevant chunks:\n`);
  results.forEach((result, i) => {
    console.log(`─── Result ${i + 1} (score: ${result.score.toFixed(3)}) ───`);
    console.log(`Source: ${result.metadata.source}`);
    console.log(`Content: ${result.content.slice(0, 150)}...\n`);
  });

  console.log('🎉 Phase 3 test complete — local embeddings + Qdrant search both work!\n');
}

main().catch((err) => {
  console.error('❌ Test failed:', err.message);
  console.error('\nCommon causes:');
  console.error('  - Qdrant not running → run: docker ps (should show "qdrant")');
  console.error('  - First run downloading the model → wait, it can take a minute');
  process.exit(1);
});