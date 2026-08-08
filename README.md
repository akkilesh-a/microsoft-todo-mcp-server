# Microsoft To Do MCP — Self Hosted

A self-hosted [Model Context Protocol](https://modelcontextprotocol.io) server for Microsoft To Do. The key problem this solves: **the Microsoft Graph API silently omits user-created lists on personal accounts** (`GET /me/todo/lists` only returns well-known lists like "Flagged Emails"). This server works around it with a local SQLite registry that tracks every list you create, so your lists always show up.

Run it on your own VPS, expose it over HTTPS, and connect any MCP-compatible AI client (Claude Code, Cursor, Claude Desktop) from any machine.

> **Credits:** Based on [jordanburke/microsoft-todo-mcp-server](https://github.com/jordanburke/microsoft-todo-mcp-server), which is a fork of [@jhirono/todomcp](https://github.com/jhirono/todomcp).

---

## The problem this fixes

Microsoft's Graph API has a limitation for personal Microsoft accounts (outlook.com, hotmail.com, live.com, Gmail linked accounts, etc.):

- `POST /me/todo/lists` — works, creates the list, returns an ID ✅
- `GET /me/todo/lists` — only returns built-in lists like "Flagged Emails", silently drops everything you created ❌

This means any MCP server that relies purely on the API for listing will never show your custom lists. This repo fixes it by maintaining a local SQLite database (`lists.db`) that persists every list created through the server, then merges it with the API response so nothing is ever missing.

---

## How it works

```
Your laptop / any machine
        │
        │  claude mcp add --transport http ...
        ▼
https://todo-mcp.yourdomain.com
        │
        ├── /          → Dashboard (connection status + quick-add commands)
        ├── /auth      → Start Microsoft OAuth
        ├── /callback  → OAuth callback (saves tokens)
        ├── /health    → Health check
        └── /mcp       → MCP endpoint (API key protected)
```

You authenticate once via the dashboard. Tokens are stored on your server and auto-refreshed. Your API key protects the MCP endpoint so only your machines can use it.

---

## Features

- **Fixes personal account list limitation** — a local list registry ensures all your lists are always visible
- **SQLite or Postgres** — zero-config SQLite file by default, or point `DATABASE_URL` at Postgres
- **HTTP transport** — connect from any machine, not just localhost
- **Dashboard** — web UI to connect your Microsoft account and get copy-paste setup commands for Claude Code, Cursor, and Claude Desktop
- **API key auth** — protects the `/mcp` endpoint
- **Dashboard password** — HTTP basic auth on the dashboard so only you can access it
- **Auto token refresh** — tokens refresh automatically, no manual intervention
- **15 MCP tools** — full task management: lists, tasks, checklist items

---

## Prerequisites

- Node.js 18+
- A server or VPS (DigitalOcean, Hetzner, etc.) with a domain pointed at it
- A Microsoft account (personal or work)
- An Azure App Registration (see below)

---

## Azure App Registration

1. Go to [portal.azure.com](https://portal.azure.com) → **App registrations** → **New registration**
2. Name it (e.g. `todo-mcp`)
3. Supported account types: **Personal Microsoft accounts** (`consumers`) or **any account** (`common`)
4. Redirect URI: `https://todo-mcp.yourdomain.com/callback` (Web)
5. After creating, go to **Certificates & secrets** → create a client secret, copy it
6. Go to **API permissions** → Add → Microsoft Graph → Delegated:
   - `Tasks.Read`, `Tasks.ReadWrite`, `Tasks.Read.Shared`, `Tasks.ReadWrite.Shared`, `User.Read`
7. Click **Grant admin consent**
8. Copy your **Application (client) ID** from the Overview page

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/akkilesh-a/microsoft-todo-mcp-server.git
cd microsoft-todo-mcp-server
npm install
npm run build
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
CLIENT_ID=your_azure_app_client_id
CLIENT_SECRET=your_azure_app_client_secret
TENANT_ID=consumers
PORT=3001
PUBLIC_URL=https://todo-mcp.yourdomain.com
REDIRECT_URI=https://todo-mcp.yourdomain.com/callback
MCP_API_KEY=your_secret_api_key        # openssl rand -hex 32
DASHBOARD_USERNAME=admin               # username for dashboard login
DASHBOARD_PASSWORD=your_dashboard_pass  # set this — protects /auth
```

### 3. Run the server

```bash
node dist/todo-index.js
```

### 4. Authenticate

Open `https://todo-mcp.yourdomain.com` in your browser, enter your dashboard password, and click **Connect Microsoft Account**. After OAuth completes, tokens are saved on the server.

### 5. Connect your AI client

The dashboard shows ready-to-copy commands. Or manually:

**Claude Code:**
```bash
claude mcp add --transport http mstodo https://todo-mcp.yourdomain.com/mcp \
  --header "Authorization: Bearer your_api_key"
```

**Cursor** — add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "mstodo": {
      "url": "https://todo-mcp.yourdomain.com/mcp",
      "headers": { "Authorization": "Bearer your_api_key" }
    }
  }
}
```

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mstodo": {
      "url": "https://todo-mcp.yourdomain.com/mcp",
      "headers": { "Authorization": "Bearer your_api_key" }
    }
  }
}
```

---

## Database

The list registry is stored in **SQLite by default** — a `lists.db` file created on first run, nothing to configure. Set `DATABASE_URL` and it uses **Postgres** instead.

```bash
# SQLite (default) — optional custom path
LIST_DB_PATH=/data/lists.db

# Postgres — set this and the SQLite file is ignored entirely
DATABASE_URL=postgres://user:password@host:5432/dbname
```

For hosted Postgres (Neon, Supabase, RDS) whose certificate chain Node will not verify by default, set `DATABASE_SSL=no-verify`. The connection stays encrypted; only chain validation is skipped.

> OAuth tokens are **not** in the database — they stay in `tokens.json` (`MSTODO_TOKEN_FILE`), so the server still needs a persistent path for that file either way.

### Sharing a database with other applications

Every table this server creates can be namespaced with a prefix, so one Postgres database can host this alongside your other apps:

```bash
DB_TABLE_PREFIX=mstodo_
```

That yields `mstodo_lists` and `mstodo_schema_migrations`. The prefix deliberately covers the migration bookkeeping table too — without it, two apps each using a bare `schema_migrations` would corrupt each other's version history and silently skip migrations. It must match a plain identifier pattern (letters, digits and underscores, not starting with a digit); anything else is rejected at startup rather than interpolated into SQL.

The prefix is empty by default, which leaves existing `lists.db` files working untouched.

### Migrations

Migrations are plain `.sql` files under `migrations/<dialect>/`, applied in filename order and recorded in `<prefix>schema_migrations`.

They run **automatically on startup** and are a no-op once the schema is current, so a normal deploy needs no extra step. To run them yourself instead:

```bash
npm run migrate                # apply anything outstanding
AUTO_MIGRATE=false npm start   # and stop the server from doing it
```

Adding a migration means dropping `002_whatever.sql` into **both** `migrations/postgres/` and `migrations/sqlite/`. Use `{{prefix}}` wherever a table name appears — the runner substitutes it:

```sql
ALTER TABLE {{prefix}}lists ADD COLUMN color TEXT;
```

Each migration is applied in a transaction together with its version row, so a failure part-way leaves neither a half-built schema nor a version record claiming success.

---

## Security

| Layer | Protection |
|-------|-----------|
| `/mcp` | `MCP_API_KEY` — required on every MCP request |
| Dashboard `/`, `/auth`, `/callback` | `DASHBOARD_USERNAME` + `DASHBOARD_PASSWORD` — HTTP basic auth |

Always set `DASHBOARD_PASSWORD`. Without it, anyone who knows your URL can visit the dashboard and trigger an OAuth flow that overwrites your tokens. `DASHBOARD_USERNAME` defaults to `admin`.

---

## MCP Tools

### Task Lists
| Tool | Description |
|------|-------------|
| `get-task-lists` | List all task lists (API + local registry) |
| `create-task-list` | Create a new list |
| `update-task-list` | Rename a list |
| `delete-task-list` | Delete a list and all its tasks |

### Tasks
| Tool | Description |
|------|-------------|
| `get-tasks` | Get tasks with filtering, sorting, pagination |
| `create-task` | Create a task (title, body, due date, importance) |
| `update-task` | Update any task properties |
| `delete-task` | Delete a task |

### Checklist Items
| Tool | Description |
|------|-------------|
| `get-checklist-items` | Get subtasks for a task |
| `create-checklist-item` | Add a subtask |
| `update-checklist-item` | Update subtask text or completion |
| `delete-checklist-item` | Remove a subtask |

### Other
| Tool | Description |
|------|-------------|
| `auth-status` | Check token status and expiry |
| `archive-completed-tasks` | Archive all completed tasks in a list |
| `get-task-lists-organized` | Grouped/categorized view of lists |

---

## License

MIT — see [LICENSE](LICENSE)
