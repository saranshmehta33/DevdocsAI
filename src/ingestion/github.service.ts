import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface RepoInfo {
  owner: string;
  repo: string;
  repoId: string;
}

export interface RepoFile {
  path: string;       // e.g. "src/app.module.ts"
  content: string;    // raw text content
  size: number;       // bytes
}

// File extensions we care about (skip images, lock files, etc.)
const SUPPORTED_EXTENSIONS = [
  '.ts', '.js', '.tsx', '.jsx',   // TypeScript / JavaScript
  '.py', '.java', '.go', '.rs',   // Other languages
  '.md', '.mdx',                  // Documentation
  '.json', '.yaml', '.yml',       // Config files
  '.sh',                          // Scripts
  '.sql',                         // Database schemas
];

const IGNORED_PATHS = [
  'node_modules/', 'dist/', 'build/', '.git/',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.min.js', '.min.css',
];

@Injectable()
export class GithubService {
    private readonly logger = new Logger(GithubService.name);
    constructor(private configService: ConfigService) {}

    parseRepoUrl(repoUrl: string): RepoInfo {
        const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\s\.]+)/);
        if (!match) {
        throw new BadRequestException(
            `Invalid GitHub URL: ${repoUrl}. Expected format: https://github.com/owner/repo`
        );
        }
        const [, owner, repo] = match;
        return {
        owner,
        repo,
        repoId: `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        };
    }

    async fetchFileTree(owner: string, repo: string): Promise<string[]> {
        this.logger.log(`Fetching file tree for ${owner}/${repo}`);

        const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`;

        try {
            const response = await axios.get(url, { headers: this.getHeaders() });

            const allFiles: Array<{ path: string; type: string; size: number }> = response.data.tree;

            const filteredFiles = allFiles
                .filter((item) => item.type === 'blob')          // files only, not folders
                .filter((item) => this.isSupportedFile(item.path))
                .filter((item) => !this.isIgnoredPath(item.path))
                .filter((item) => item.size < 100_000)             // skip files > 100KB
                .map((item) => item.path);

            this.logger.log(
                `Found ${allFiles.length} total files, ${filteredFiles.length} after filtering`
            );
            return filteredFiles;
        } catch (error: any) {
            if (error.response?.status === 404) {
                throw new BadRequestException(`Repository ${owner}/${repo} not found or is private`);
            }
            if (error.response?.status === 403) {
                throw new BadRequestException(
                'GitHub API rate limit exceeded. Add GITHUB_TOKEN to .env to raise the limit from 60 to 5000 req/hr'
                );
            }
            throw error;
        }
    }


    async fetchFileContent(
        owner: string,
        repo: string,
        filePath: string
    ): Promise<RepoFile | null> {
        try {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
        const response = await axios.get(url, { headers: this.getHeaders() });

        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');

        return {
            path: filePath,
            content,
            size: response.data.size,
        };
        } catch (error: any) {
            // Some files fail (binary disguised as text, submodules, etc.) — skip, don't crash
            this.logger.warn(`Skipping ${filePath}: ${error.message}`);
            return null;
        }
    }


    async fetchAllFiles(owner: string, repo: string, filePaths: string[]): Promise<RepoFile[]> {
        this.logger.log(`Fetching content for ${filePaths.length} files...`);

        const files: RepoFile[] = [];
        const BATCH_SIZE = 10;

        for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);

        // allSettled (not all) so one failed file doesn't kill the whole batch
        const results = await Promise.allSettled(
            batch.map((path) => this.fetchFileContent(owner, repo, path))
        );

        for (const result of results) {
            if (result.status === 'fulfilled' && result.value !== null) {
            files.push(result.value);
            }
        }

        if (i + BATCH_SIZE < filePaths.length) {
            await this.delay(200);
        }

        this.logger.log(
            `Progress: ${Math.min(i + BATCH_SIZE, filePaths.length)}/${filePaths.length} files`
        );
        }

        return files;
  }


    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            Accept: 'application/vnd.github.v3+json',
        };
        const token = this.configService.get<string>('GITHUB_TOKEN');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

     private isSupportedFile(filePath: string): boolean {
        return SUPPORTED_EXTENSIONS.some((ext) => filePath.endsWith(ext));
    }

    private isIgnoredPath(filePath: string): boolean {
        return IGNORED_PATHS.some((ignored) => filePath.includes(ignored));
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}