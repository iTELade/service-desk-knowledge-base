# iTELade Service Desk Knowledge Base

Self-hosted, Confluence-inspired knowledge platform for technical documentation, runbooks, procedures and customer-facing knowledge. It runs independently from iTELade Service Desk and exposes a scoped API that Service Desk can consume as an external knowledge source.

**Current application version: 0.5.0**  
**Data schema: 1**  
**Default UI/content language: English**  
**Additional supported UI/content language: Polish**

## What 0.5.0 changes

0.5.0 replaces the original read-only Markdown catalogue with an actual Knowledge Base application.

The product now includes:

- Confluence-like spaces with stable keys, descriptions, icons and visibility,
- hierarchical pages with a persistent page tree,
- drag/drop page moves in the navigation tree,
- draft autosave and explicit publishing,
- immutable published revision history and restore-as-draft,
- public, internal and restricted visibility modes,
- local user accounts with `viewer`, `editor` and `admin` roles,
- first-run local administrator setup,
- password hashing with Node.js `scrypt`,
- session cookies and CSRF protection for mutations,
- global, permission-aware search,
- labels, recent pages and starred pages,
- page watches,
- comments, replies and resolve/reopen state,
- page attachments up to 5 MB,
- audit log,
- system health and storage overview,
- JSON backup export,
- scoped service API tokens,
- stable Service Desk search/page API,
- English/Polish UI switch,
- responsive light-only Confluence/JSM-inspired interface,
- Docker persistence through `/data`,
- automatic import of the old Git-backed Markdown articles on first start.

The Knowledge Base remains a standalone product. Service Desk is a consumer of its API, not a runtime dependency.

## Quick start

```bash
git clone https://github.com/iTELade/service-desk-knowledge-base.git
cd service-desk-knowledge-base
docker compose up -d --build
```

Open:

```text
http://SERVER_IP:8080
```

On an empty data volume the application opens a one-time setup flow for the local administrator.

For production use put the container behind HTTPS (for example Nginx Proxy Manager). Secure session cookies are enabled by default.

## Docker Compose

`compose.yml` persists all mutable state and uploads in the named volume `knowledge-base-data`:

```yaml
volumes:
  - knowledge-base-data:/data
```

Important environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `KB_DATA_DIR` | `/data` | Persistent state and attachment storage |
| `KB_BRAND` | `iTELade Knowledge Base` | Product name displayed in the UI |
| `KB_DEFAULT_LANG` | `en` | Default language for new content |
| `KB_SECURE_COOKIE` | secure | Set to `false` only for local HTTP development |

Health endpoint:

```text
GET /healthz
```

## Product model

### Spaces

Spaces are the top-level documentation boundary. Every space has:

- a stable ID and key,
- name, description and icon,
- `public`, `internal` or `restricted` visibility,
- page hierarchy,
- optional user-level view/edit/admin grants for restricted spaces.

### Pages

Pages have stable IDs independent from title/slug changes and support:

- parent/child hierarchy,
- language metadata,
- summary and labels,
- draft content,
- explicit publishing,
- published revisions,
- archive/restore,
- per-page view/edit restrictions,
- comments, attachments, favorites and watches.

The editor uses a safe Markdown content model with a rich authoring toolbar and live preview. Rendering escapes raw HTML before applying supported formatting so page content cannot inject arbitrary HTML/JavaScript.

### Roles

- `viewer` — authenticated reader/commenter,
- `editor` — creates and maintains content in allowed spaces,
- `admin` — system, identity, integration and all-content administration.

A local administrator is always available as an emergency/break-glass account even when enterprise identity providers are added later.

## Service Desk API

Create a token in **Administration → API tokens**. The token secret is shown once.

Authentication:

```http
Authorization: Bearer kb_<secret>
```

Available integration endpoints:

```text
GET /api/v1/health
GET /api/v1/search?q=reset&language=en
GET /api/v1/pages/:stablePageId
```

Scopes:

- `health`
- `search`
- `read`

A token can additionally be allowed to read internal knowledge. Restricted content is not returned unless that visibility is explicitly granted to the token.

This API is the intended integration direction:

```text
Service Desk  ─────►  Knowledge Base API
```

Knowledge Base does not require Service Desk to start, authenticate users, edit pages or serve knowledge.

## Legacy Markdown import

The existing `articles/` directory is preserved for migration compatibility. On the first start of a fresh 0.5.0 data volume, published legacy articles are imported into a `DOCS` space and converted into native pages/revisions.

After import, `/data/knowledge-base.json` becomes the authoritative mutable application store. Existing Git Markdown files are not continuously mirrored back into the runtime store.

## Persistence and backup

Persistent runtime files:

```text
/data/knowledge-base.json
/data/uploads/
```

Administrators can download a JSON backup from the Administration page. Token hashes are redacted from that browser export.

For infrastructure-level backup, back up the complete `/data` volume while the container is stopped or use a storage snapshot with filesystem consistency guarantees.

## Repository structure

```text
articles/                 legacy/import seed content
config/                   legacy content metadata documentation
docs/                     architecture and integration documentation
public/
  index.html              application shell
  app.js                  SPA controller
  style.css               canonical product design system
  favicon.svg
server.mjs                HTTP API, persistence, auth and rendering
compose.yml
Dockerfile
tests/
```

## Security baseline

0.5.0 includes:

- `scrypt` password hashing with per-password salts,
- HttpOnly + SameSite=Lax session cookies,
- Secure cookies by default,
- CSRF token validation for authenticated mutations,
- permission checks on every page/search/attachment API,
- no raw HTML execution from page Markdown,
- 5 MB attachment size limit,
- safe generated attachment storage names,
- scoped and revocable integration tokens stored only as SHA-256 hashes,
- audit events for content, identity and integration changes.

## CI

Every pull request to `main` runs:

```bash
npm run check
npm test
docker build ...
container health/bootstrap smoke test
```

The application test suite covers first-run setup, authenticated sessions, spaces, drafts, publishing, revisions, permission-aware search, comments, favorites, attachments and Service Desk API tokens.

## Roadmap after 0.5.0

The core is intentionally designed so the next releases can add enterprise identity and richer collaboration without replacing the page model:

- OIDC / Keycloak login,
- LDAP / Active Directory synchronization and group mapping,
- richer WYSIWYG/block editor,
- groups and more granular inherited permission UI,
- review/approval workflow before publication,
- notifications for watches and mentions,
- attachment version replacement and optional antivirus hook,
- translation relationship management,
- advanced full-text index and relevance tuning,
- richer Service Desk suggestions and article linking UI.

Those are follow-up features, not prerequisites for the standalone 0.5.0 Confluence Core.

## License

Use and distribution are governed by the license in this repository. Do not expose secrets, production backups or integration tokens in Git.
