# iTELade Knowledge Base 0.5.0 — Confluence Core

0.5.0 is the first full application release of iTELade Knowledge Base. It replaces the original read-only Markdown catalogue with a standalone collaborative knowledge platform.

## Core workspace

- Confluence-inspired light workspace with global header, spaces sidebar and hierarchical page tree.
- Space home views, page cards, global search, recent pages and starred pages.
- Responsive layout for desktop, tablet and mobile.
- English-first interface with a Polish UI switch.

## Spaces and pages

- Create and configure spaces with stable keys, icons, descriptions and visibility.
- Public, internal and restricted space visibility modes.
- Stable page IDs independent from titles and slugs.
- Hierarchical pages and drag/drop moves in the page tree.
- Draft working copies with autosave.
- Explicit publishing.
- Immutable published revision history.
- Restore old revisions into a new draft.
- Archive and restore pages.
- Labels, summaries and page language metadata.

## Collaboration

- Page comments and threaded replies.
- Resolve/reopen comment state.
- Star/favorite pages.
- Watch pages.
- Recently viewed history.
- Page attachments with permission-aware download.

## Identity and security

- One-time first-run administrator setup.
- Local viewer/editor/admin accounts.
- Password hashing with Node.js scrypt and unique salts.
- HttpOnly, SameSite=Lax session cookies.
- Secure cookies by default behind HTTPS.
- CSRF validation for authenticated mutations.
- Permission-aware search, page access and attachment access.
- Safe Markdown renderer that does not execute raw article HTML.

## Administration

- Local user management.
- Audit log.
- System/version/storage health view.
- JSON backup export.
- Scoped and revocable API tokens.

## Service Desk integration

Knowledge Base remains independent from Service Desk. Service Desk consumes the Knowledge Base through scoped server-to-server endpoints:

- `GET /api/v1/health`
- `GET /api/v1/search`
- `GET /api/v1/pages/:pageId`

Token secrets are shown once and persisted only as SHA-256 hashes.

## Persistence and migration

- Data schema: **1**.
- Runtime state is stored under `/data/knowledge-base.json`.
- Attachments are stored under `/data/uploads/`.
- Docker Compose now persists `/data` in a named volume.
- On a fresh 0.5.0 data directory, existing published Markdown articles from `articles/` are automatically imported into the native `DOCS` space.

## Validation

The release gate includes syntax checks, application end-to-end tests, Docker build and container smoke tests.
