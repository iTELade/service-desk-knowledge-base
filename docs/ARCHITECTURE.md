# Knowledge Base architecture — 0.5.0

## Product boundary

iTELade Knowledge Base is a standalone application. Its availability, authentication and content lifecycle do not depend on Service Desk.

Service Desk integration is intentionally one-way at the platform boundary:

```text
Service Desk -> scoped Knowledge Base REST API
```

The Knowledge Base does not mirror a ticket database and does not create Service Desk tickets as part of the 0.5 core.

## Runtime

- Node.js 24
- built-in `http` server
- no runtime npm dependencies
- persistent JSON state under `/data/knowledge-base.json`
- attachment binaries under `/data/uploads/`
- immutable legacy Markdown seed content under `/app/articles/`

The single-store design is deliberate for the current deployment size. Stable entity IDs and schema versioning keep a future SQLite/PostgreSQL migration possible without changing public URLs or Service Desk API identifiers.

## State schema 1

Primary collections:

- `users`
- `spaces`
- `pages`
- `revisions`
- `comments`
- `attachments`
- `favorites`
- `watches`
- `recents`
- `audit`
- `tokens`

Published revisions are append-only. Restoring a revision copies its content into a new draft; it does not rewrite the historical revision.

## Identity and sessions

0.5.0 provides local identities as the dependable break-glass authentication layer.

Passwords use Node.js `scrypt` with a random per-password salt. Session identifiers are random 256-bit values held in server memory and delivered in HttpOnly, SameSite=Lax cookies. Production cookies are Secure by default.

Every authenticated mutation requires the session CSRF token in `X-CSRF-Token`.

Future OIDC/LDAP providers should map external identities onto the stable local `user.id`; provider identifiers must never replace the internal identity key.

## Authorization

Global roles:

- viewer
- editor
- admin

Content access is evaluated in layers:

1. global role,
2. space visibility and restricted-space grants,
3. page visibility,
4. page-level view/edit restrictions,
5. page lifecycle state.

Public unauthenticated users can read only published pages in public spaces that are not page-restricted.

## Content lifecycle

A page contains both published content and a working draft.

```text
create -> draft -> publish -> published
                    |             |
                    |             +-> edit draft -> publish new revision
                    +-> archive <-+
```

Autosave changes only the working copy. Publishing creates the immutable revision and updates the public page representation.

## Stable identifiers

Space IDs and page IDs are UUID-based and never derived from titles or slugs. Slugs are presentation metadata and may change when a title changes.

Service Desk must store the stable `page.id`, not a URL slug.

## Attachments

Attachment metadata is stored in state. Binary data uses generated storage names under `/data/uploads/`; original user filenames are metadata only.

Downloads always re-evaluate permission against the owning page.

## Search

0.5.0 uses an in-memory relevance scorer over accessible pages. Authorization filtering occurs before results are returned.

The public Service Desk API performs the same visibility filtering against token scopes. A future full-text index must preserve this authorization-before-disclosure behavior.

## Integration tokens

Service API token secrets are returned once and only SHA-256 hashes are persisted. Tokens have explicit scopes and optional internal/restricted visibility capability.

Revocation is immediate because every request resolves the token against current state.

## Backups

Browser JSON export redacts integration token hashes and is intended for inspection/configuration recovery.

Disaster recovery should protect the complete `/data` volume, including the state file and attachment directory.

## Upgrade rules

- `VERSION` is the product version.
- `SCHEMA_VERSION` changes only when persistent state requires migration.
- schema migrations must be deterministic and idempotent.
- a UI-only release must not increment the schema.
- release CI must test both fresh first-run setup and an existing data directory before production rollout.
