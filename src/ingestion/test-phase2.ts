import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { GithubService } from './github.service';
import { ChunkingService } from './chunking.service';

async function main() {
  // Manually construct services (skip NestJS DI container for this quick test)
  const configService = new ConfigService();
  const githubService = new GithubService(configService);
  const chunkingService = new ChunkingService();

  // Use a SMALL repo for testing — big repos will eat your GitHub rate limit
  const testRepoUrl = 'https://github.com/jahio/hello-world-node-express';

  console.log(`\n🔍 Testing with repo: ${testRepoUrl}\n`);

  // Step 1: Parse the URL
  const { owner, repo, repoId } = githubService.parseRepoUrl(testRepoUrl);
  console.log(`✅ Parsed: owner=${owner}, repo=${repo}, repoId=${repoId}\n`);

  // Step 2: Fetch file tree
  const filePaths = await githubService.fetchFileTree(owner, repo);
  console.log(`✅ Found ${filePaths.length} files:`);
  filePaths.forEach((p) => console.log(`   - ${p}`));

  // Step 3: Fetch file contents
  const files = await githubService.fetchAllFiles(owner, repo, filePaths);
  console.log(`\n✅ Fetched content for ${files.length} files`);

  // Step 4: Chunk the files
  const chunks = await chunkingService.chunkFiles(files, repoId, testRepoUrl);
  console.log(`\n✅ Created ${chunks.length} chunks\n`);

  // Show the first chunk so you can see the shape of the data
  console.log('📄 Sample chunk:');
  console.log('─'.repeat(60));
  console.log('Content:', chunks[0].pageContent.slice(0, 200), '...');
  console.log('Metadata:', chunks[0].metadata);
  console.log('─'.repeat(60));

  console.log('\n🎉 Phase 2 test complete — GitHub fetch + chunking both work!\n');
}

main().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});