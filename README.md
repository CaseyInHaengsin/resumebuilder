# Resume Builder

A self-hosted personal resume builder and job-application tracker. It keeps a content library of jobs, projects, bullets, summaries and skills. Resumes are assembled from that library with a live PDF preview in three templates (modern, classic, minimal). Applications move through a pipeline board, and companies and network contacts are tracked alongside them. An MCP endpoint, protected by OAuth or a bearer token, lets Claude read and update the data (see `app/mcp/`).

Stack: React Router 7 (server-rendered), React 19, TypeScript, Tailwind CSS 4, SQLite via better-sqlite3 and Drizzle ORM, `@react-pdf/renderer` for PDFs, Vitest.

## Getting started

Prerequisites: Node 26 (see `.nvmrc`) and pnpm 10 (pinned by `packageManager` in `package.json`).

```bash
pnpm install
node scripts/migrate.mjs   # creates data/resume.db and applies the migrations in drizzle/
pnpm dev                   # dev server with HMR on http://localhost:5173
```

Open http://localhost:5173/signup and create the first account. Signup is enabled outside production; see `ALLOW_SIGNUP` below.

To change the schema, edit `app/db/schema.ts`, then run `pnpm db:generate` and commit the new file in `drizzle/`. The app applies pending migrations at container start in production.

## Scripts

| Script | Runs | Purpose |
|---|---|---|
| `pnpm dev` | `react-router dev` | Development server with HMR |
| `pnpm build` | `react-router build` | Production build into `build/` |
| `pnpm start` | `react-router-serve ./build/server/index.js` | Serve the production build (run `pnpm build` first) |
| `pnpm test` | `vitest run` | Run the tests in `tests/` |
| `pnpm typecheck` | `react-router typegen && tsc` | Generate route types and type-check |
| `pnpm db:generate` | `drizzle-kit generate` | Write a SQL migration for schema changes |
| `pnpm db:push` | `drizzle-kit push` | Apply the schema directly, without a migration. Local experiments only (see DEPLOYMENT.md) |
| `pnpm db:studio` | `drizzle-kit studio` | Open Drizzle Studio on the database |
| `pnpm db:seed` | `tsx scripts/seed.ts` | Import a resume YAML file for a user: `pnpm db:seed -- <file.yaml> --user=<username>` |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | unset (treated as development) | `production` enables the production defaults below. The Docker image sets it. |
| `SESSION_SECRET` | insecure dev fallback, with a startup warning | Signs session cookies. Set it in production with `openssl rand -hex 32`. |
| `COOKIE_SECURE` | `true` when `NODE_ENV=production`, otherwise `false` | Marks the session cookie `Secure`. Set `"true"` once HTTPS fronts the app. |
| `ALLOW_SIGNUP` | off in production, on otherwise | Set to `"true"` to enable `/signup`. Any other value disables it. |
| `PUBLIC_URL` | `http://localhost:5173` outside production | Browser-facing origin, for example `https://resume.example.com`. Used for OAuth issuer and resource URLs, so the MCP endpoint is `<PUBLIC_URL>/mcp`. Required in production; the app throws on first use if it is missing. |
| `DATABASE_PATH` | `data/resume.db` (relative to the working directory) | SQLite database file. Read by the app and `scripts/migrate.mjs`. |
| `UPLOADS_DIR` | `data/uploads` | Directory for uploaded images (2 MB limit; JPEG, PNG, GIF, WEBP or SVG). |
| `DOCUMENTS_DIR` | `data/documents` | Directory for PDF copies saved with applications. Created on the first save. |
| `FONTS_DIR` | `public/fonts`, else `build/client/fonts` (relative to the working directory) | Fonts for PDFs rendered on the server. Only needed if the fonts live somewhere else. |
| `APP_TIMEZONE` | the process's local time zone | IANA time zone used for "today" on the applications pages and in the MCP write tools. |

## Deployment

The production image is built by `build-and-push.sh` and runs on a home server through Portainer, using `docker-compose.prod.yml` as the reference stack. The container keeps the database, uploads and saved PDFs under `/app/data`, and migrations run on each start. See [DEPLOYMENT.md](DEPLOYMENT.md) for the steps and the production environment variables.

## MCP

This app exposes your resume/job-search data to Claude (Desktop or Code) via the [Model Context Protocol](https://modelcontextprotocol.io), letting you ask Claude to read your profile, coach you through interview pipelines, or suggest what to learn based on companies you're tracking — all against live app state.

### Endpoints

- **Dev**: `http://localhost:5173/mcp`
- **Prod**: `https://<your-host>/mcp`

Both accept `POST` (JSON-RPC) and `GET` (SSE). There are two ways to authenticate:

- **OAuth** — the only option for claude.ai and the mobile apps, and the easiest for Claude Code. Nothing to copy or paste; you approve a consent screen instead. See [Connect Claude web and mobile](#connect-claude-web-and-mobile).
- **A bearer token** from `/settings` — for hand-written Claude Desktop / Claude Code config.

### Connect Claude web and mobile

Connectors are added on claude.ai and then used everywhere, **including iOS and
Android** — the mobile apps can use a connector but can't add one, so this step
happens on the web once.

1. Deploy with `PUBLIC_URL` set (see [DEPLOYMENT.md](DEPLOYMENT.md)). The server must be reachable over HTTPS.
2. On claude.ai: **Settings → Connectors → Add custom connector**.
3. URL: `https://<your-host>/mcp`. Leave the OAuth client ID and secret blank — the server supports Dynamic Client Registration, so Claude registers itself.
4. Claude opens the app's sign-in page, then a consent screen. Approve it.
5. Open Claude on your phone. The `resume-builder` tools are there.

For **Claude Code**, the same flow works without a token:

```bash
claude mcp add resume-builder --transport http --url https://<your-host>/mcp
```

It opens a browser for consent and stores the tokens itself.

<details>
<summary>How the OAuth side is put together</summary>

The app is its own authorization server; there is no external identity provider.

| Endpoint | Purpose |
|---|---|
| `/.well-known/oauth-protected-resource` | RFC 9728 metadata; also served at `/…/oauth-protected-resource/mcp` |
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata |
| `/oauth/register` | RFC 7591 dynamic client registration (JSON) |
| `/oauth/authorize` | Consent screen, gated on your normal app login |
| `/oauth/token` | Code exchange and refresh (form-urlencoded) |

Access tokens last an hour, refresh tokens 30 days and rotate on every use.
Tokens are bound to `<PUBLIC_URL>/mcp` as their audience. Scopes are `mcp:read`
and `mcp:write`; a token without `mcp:write` is not offered the write tools at
all. Registration only accepts callbacks on `claude.ai` / `claude.com` or an
RFC 8252 loopback address.

</details>

### Generate a token

1. Log in to the app
2. Visit **Settings** in the top nav
3. Click **Generate MCP Token**
4. Copy the token — it's shown once and never again
5. Store it in your MCP client (below). Regenerating from `/settings` revokes the old token.

### Connect Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "resume-builder": {
      "transport": {
        "type": "streamable-http",
        "url": "http://localhost:5173/mcp",
        "headers": {
          "Authorization": "Bearer rbmcp_YOUR_TOKEN_HERE"
        }
      }
    }
  }
}
```

Restart Claude Desktop. The `resume-builder` tools appear in the tools drawer.

### Connect Claude Code

```bash
claude mcp add resume-builder \
  --transport http \
  --url http://localhost:5173/mcp \
  --header "Authorization: Bearer rbmcp_YOUR_TOKEN_HERE"
```

### Tool inventory

| Tool | Purpose |
|---|---|
| `get_profile` | Full dump: user, contact, education, summaries, resumes, jobs, projects, bullets, skills, companies, applications, tech-stack |
| `get_contact`, `get_education` | Singleton entities |
| `list_summaries` | Resume summary paragraphs |
| `list_resumes`, `get_resume` | Resumes (get: composed with selected jobs/projects/bullets/skills/summary/company) |
| `list_applications`, `get_application` | Application pipeline (list: optional `status` filter; get: with company and saved PDF copies) |
| `list_jobs`, `get_job` | Work history (get: with bullets) |
| `list_projects`, `get_project` | Side projects (get: with bullets) |
| `list_companies`, `get_company` | Research targets |
| `get_skills` | Skill groups |
| `get_resume_pdf_link` | Link to a resume rendered as a PDF right now, plus its download name; opens only where the user is signed in to the app |
| `get_keyword_coverage` | Which job-posting terms a resume covers, has in the library unused, or lacks (`resumeId`, `applicationId`) |
| `get_tech_stack` | Unified tech-keyword graph (nodes + co-occurrence links) |
| `list_bullets_for` | Bullets for a specific job or project |
| `update_application_status` | Move an application through the pipeline (wishlist/applied/interviewing/offer/accepted/rejected); wishlist to applied also saves a copy of the linked resume |
| `snapshot_application_resume` | Save a frozen PDF copy of the application's linked resume ("what I sent"); `get_application` lists saved copies with download links |
| `append_application_note` | Append a timestamped note to an application |
| `add_skill` | Create a new skill group `(category, name, items)` |
| `add_bullet` | Add a bullet to a job or project |
| `create_company` | Find or create a company by name (case-insensitive), with optional research fields |
| `create_application` | Create an application with the posting text; link a company by id or find-or-create it by name |
| `update_application` | Change an application's details or link a resume (status and notes have their own tools) |
| `add_summary` | Save a new summary paragraph `(name, text)` |
| `create_resume` | Assemble a resume from library ids in page order; each bullet's job or project must be selected |
| `update_resume` | Rename, retemplate, or replace any of a resume's ordered job/project/skill/bullet lists |

All tools are scoped to the token-bearer's user. Writes are intentionally narrow — nothing is deleted through MCP, and jobs, projects and other library entries beyond bullets, skills and summaries are created in the web UI.

### Troubleshooting

- **401 on every request**: token is missing, malformed, or was revoked. Regenerate from `/settings`.
- **Claude Desktop doesn't list the server**: restart after editing `claude_desktop_config.json`; check the file is valid JSON.
- **Tools work but writes don't reflect in the UI**: make sure you're logged in as the same user the token was generated for.
- **"Couldn't reach the MCP server" when adding a connector**: almost always `PUBLIC_URL`. Check that `curl https://<your-host>/.well-known/oauth-protected-resource/mcp` returns a document whose `resource` is exactly the URL you typed into Claude, and that `issuer` in `/.well-known/oauth-authorization-server` matches the host you fetched it from.
- **"Unknown client_id" on the consent screen**: the registration was pruned (unused registrations are dropped after 30 days). Remove and re-add the connector.
- **Only read tools appear**: the token was granted `mcp:read` but not `mcp:write`. Disconnect and reconnect to re-consent.

---

Built with ❤️ using React Router.
