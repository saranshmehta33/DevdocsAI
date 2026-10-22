# DevDocs AI

**Ask questions about any public GitHub codebase in plain English and get answers grounded in the actual source, with the files they came from cited.**

DevDocs AI is a NestJS backend that indexes a GitHub repository into a vector database and answers natural-language questions about it using Retrieval-Augmented Generation (RAG). It is available three ways: a web UI, a REST API, and an MCP server that AI clients like Claude Desktop can call as a tool.

![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white)
![Qdrant](https://img.shields.io/badge/Qdrant-DC244C)
![LangChain](https://img.shields.io/badge/LangChain-1C3C3C)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

**Live demo:** [https://devdocsai-mc2q.onrender.com](https://devdocsai-mc2q.onrender.com) (free tier, so the first request after idle can take 30-60 seconds to wake up)

<!-- Add a screenshot or GIF of the UI here:
![DevDocs AI screenshot](docs/screenshot.png)
-->

---

## Features

- **Index any public GitHub repo** by pasting its URL, with live indexing status
- **Grounded answers with citations**: the model answers only from retrieved code and lists the source files
- **Fully local embeddings**: no embedding API, no per-token cost
- **Fast generation** with Llama 3.3 70B on Groq
- **Three interfaces over the same services**: web UI, REST API, MCP server
- **Dockerized**: the full stack (app, Qdrant, MongoDB) starts with one command

---

## How It Works

```
GitHub repo URL
      |
      v
GithubService      fetch file tree + contents (GitHub REST API)
      |
      v
ChunkingService    split into overlapping chunks (LangChain)
      |
      v
EmbeddingService   local model -> 384-dim vectors (Transformers.js)
      |
      v
Qdrant             store vectors + metadata (file path, chunk index)

                  --- at question time ---

Question -> embed -> top-5 similarity search in Qdrant
         -> prompt with retrieved chunks -> Groq (Llama 3.3 70B)
         -> answer + source files
```

MongoDB tracks each repository's indexing status (`indexing`, `ready`, `failed`) and file/chunk counts so the UI can poll progress.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | NestJS, TypeScript |
| Orchestration / chunking | LangChain (`RecursiveCharacterTextSplitter`) |
| Embeddings | `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers` (runs locally, 384 dimensions) |
| Vector database | Qdrant (cosine similarity) |
| LLM | Llama 3.3 70B Versatile on Groq |
| Metadata store | MongoDB (Mongoose) |
| AI tool protocol | Model Context Protocol (MCP) over stdio |
| Packaging / deploy | Docker, Docker Compose, Render, Qdrant Cloud, MongoDB Atlas |

---

## Key Design Decisions

- **Local embeddings instead of an embeddings API.** Removes cost and an external dependency. The tradeoff is speed: embedding runs on CPU, so large repositories index slowly (see [Limitations](#limitations)).
- **Chunks of 800 characters with 150 overlap.** Small enough for precise retrieval, with overlap so a function signature and its body are not split apart.
- **Answers restricted to retrieved context.** The prompt tells the model to use only the provided code and to say so when the context does not contain the answer. Temperature is 0.2.
- **One service layer, three interfaces.** The REST controller and the MCP tools call the same ingestion and retrieval services, so there is no duplicated logic.
- **Background ingestion.** `POST /repos/index` returns immediately with a `repoId`; clients poll the status endpoint.

---

## Project Structure

```
src/
  main.ts                    App bootstrap, static frontend, validation
  app.module.ts              Root module (config, MongoDB, feature modules)
  api/                       REST controller + DTOs
  ingestion/
    github.service.ts        GitHub API: file tree + file contents
    chunking.service.ts      Text splitting + metadata
    embedding.service.ts     Local embeddings + Qdrant read/write
    ingestion.service.ts     Orchestrates the full ingestion pipeline
  retrieval/
    retrieval.service.ts     RAG: retrieve -> prompt -> Groq -> cited answer
  repository/                MongoDB schema + service for indexing status
  mcp/
    mcp-server.ts            Standalone MCP server (stdio)
public/
  index.html                 Web UI
Dockerfile
docker-compose.yml
```

---

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Docker (for Qdrant and MongoDB, or for the full Docker setup)
- A free [Groq API key](https://console.groq.com)
- A GitHub personal access token (recommended; no scopes needed for public repos)

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/devdocs-ai.git
cd devdocs-ai
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_api_key
GITHUB_TOKEN=your_github_token
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=
MONGODB_URI=mongodb://127.0.0.1:27017/devdocs-ai
PORT=3000
```

| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | Yes | Used for answer generation |
| `GITHUB_TOKEN` | Recommended | Raises the GitHub API limit from 60 to 5,000 requests/hour. Use a token with an expiry long enough for your needs. |
| `QDRANT_URL` | Yes | Use `127.0.0.1`, not `localhost`, to avoid IPv6 resolution issues with Docker Desktop on Windows |
| `QDRANT_API_KEY` | Only for Qdrant Cloud | Leave empty for a local Qdrant |
| `MONGODB_URI` | Yes | Local or MongoDB Atlas connection string |
| `PORT` | No | Defaults to 3000 |

Never commit `.env`. Make sure it is listed in `.gitignore`.

### 3a. Run locally (app on host, databases in Docker)

```bash
docker run -d --name qdrant -p 6333:6333 -v qdrant_data:/qdrant/storage qdrant/qdrant
docker run -d --name mongodb -p 27017:27017 -v mongo_data:/data/db mongo:7

npm run start:dev
```

Open `http://localhost:3000`. The first start downloads the embedding model (about 90 MB) and caches it.

### 3b. Run everything with Docker Compose

```bash
docker-compose up --build
```

Compose reads `GROQ_API_KEY` and `GITHUB_TOKEN` from your `.env` and wires the app to the Qdrant and MongoDB containers by service name.

> The image uses `node:20-slim` (Debian), not Alpine. The embedding runtime (`onnxruntime-node`) ships a native binary built against glibc and fails to load on Alpine's musl libc.

---

## REST API

Base path: `/api/v1`

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/repos/index` | Start indexing a repo. Returns `202` with a `repoId` immediately. |
| `GET` | `/repos/:id/status` | Poll indexing status: `indexing`, `ready`, or `failed` |
| `POST` | `/repos/:id/query` | Ask a question about an indexed repo |
| `GET` | `/repos` | List all indexed repos |
| `DELETE` | `/repos/:id` | Remove a repo from MongoDB and Qdrant |

### Example

```bash
# 1. Start indexing
curl -X POST http://localhost:3000/api/v1/repos/index \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/jahio/hello-world-node-express"}'

# 2. Poll until status is "ready"
curl http://localhost:3000/api/v1/repos/jahio-hello-world-node-express/status

# 3. Ask a question
curl -X POST http://localhost:3000/api/v1/repos/jahio-hello-world-node-express/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What port does this app listen on?"}'
```

Query response:

```json
{
  "answer": "The app listens on process.env.PORT or defaults to 3000. (Source: app.js)",
  "sources": ["app.js", "package.json"],
  "retrievedChunks": 2
}
```

`repoId` is `<owner>-<repo>`, lowercased, with non-alphanumeric characters replaced by `-`.

---

## MCP Server

The MCP server lets AI clients such as Claude Desktop index and query repositories as tools.

| Tool | Input | Description |
|---|---|---|
| `index_repository` | `repoUrl` | Fetch, chunk, embed, and store a repository |
| `query_codebase` | `question`, `repoId` | Answer a question about an indexed repository, with sources |

Qdrant must be running and reachable before the tools are called.

### Connect to Claude Desktop

Add this to `claude_desktop_config.json` (use an absolute path to the file):

```json
{
  "mcpServers": {
    "devdocs-ai": {
      "command": "npx",
      "args": ["ts-node", "/absolute/path/to/devdocs-ai/src/mcp/mcp-server.ts"]
    }
  }
}
```

Fully quit and reopen Claude Desktop afterwards. To check that the server starts, you can also run it directly:

```bash
npx ts-node src/mcp/mcp-server.ts
```

### Implementation notes

MCP over stdio requires stdout to contain only JSON-RPC messages. Logger output, dotenv banners, and library output on stdout corrupt the stream and surface as vague "fetch failed" errors in the client. `mcp-server.ts` therefore:

- redirects any non-JSON write to stdout onto stderr,
- silences the NestJS logger, and
- loads `.env` from an explicit path, because the client may launch the process from a different working directory.

---

## Deployment

The app is deployed using free tiers:

| Component | Service |
|---|---|
| App (from the `Dockerfile`) | Render |
| Vector database | Qdrant Cloud |
| Database | MongoDB Atlas |

Set `GROQ_API_KEY`, `GITHUB_TOKEN`, `QDRANT_URL`, `QDRANT_API_KEY`, and `MONGODB_URI` in the host's environment settings. Allow the host to connect to Atlas under Network Access.

---

## Limitations

- **Slow indexing on CPU.** Embedding runs locally on CPU. On Render's free tier it ran at roughly 30 chunks per minute, so a repository that produces ~1,900 chunks takes on the order of an hour. Small and medium repositories (tens of files) are the intended use. Options for scaling: batch the embedding calls, use GPU inference or a hosted embeddings API, and move ingestion to a job queue.
- **Public repositories only.**
- **Limited file types.** Indexes `.ts .js .tsx .jsx .py .java .go .rs .md .mdx .json .yaml .yml .sh .sql`. Skips `node_modules`, `dist`, `build`, `.git`, lock files, minified files, and files over 100 KB. HTML and other formats are not indexed.
- **Free-tier behavior.** Render sleeps after 15 minutes idle. Qdrant Cloud free clusters are suspended after a week of inactivity and deleted after four, which makes indexing fail until the cluster is resumed or recreated.
- **No formal benchmark yet.** Answers have been spot-checked on small repositories. A proper evaluation of retrieval hit rate, answer correctness, and latency is planned.

<!--
Once you have eval results, add a section here, for example:

## Evaluation
Run against <repo>, N questions, <environment>:
- Right source file retrieved: X / N
- Answers judged correct: X / N
- Median latency: X s
-->

---

## Roadmap

- Batched embedding for faster indexing
- Evaluation set for retrieval hit rate, answer correctness, and latency
- Job queue (e.g. BullMQ) for ingestion
- Re-index only changed files
- Support for private repositories

---

## License

Add a `LICENSE` file of your choice (MIT is a common default for portfolio projects).
