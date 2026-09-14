# Service Desk synchronization contract

This repository is designed to synchronize Markdown knowledge articles with iTELade Service Desk.

## Source of truth

GitHub is the source of truth for article content and metadata stored in front matter.

Service Desk may keep runtime-only fields such as its database ID, synchronization timestamps, last commit SHA and delivery status.

## Identity

Articles are identified by `article_id`.

Translations of the same article must use the same `article_id` and different `language` values.

Example:

- `articles/en/getting-started/welcome.md` -> `article_id: kb-0001`, `language: en`
- `articles/pl/getting-started/welcome.md` -> `article_id: kb-0001`, `language: pl`, `translation_of: en`

Filenames and paths must not be used as permanent database identifiers.

## Recommended synchronization flow

1. A commit reaches the configured branch, normally `main`.
2. GitHub sends a signed webhook to Service Desk, or Service Desk polls the repository as a fallback.
3. Service Desk resolves changed files under `articles/`.
4. Front matter is validated against `config/schema.yml`.
5. Categories are validated against `config/categories.yml`.
6. For every file with `service_desk.sync: true`, Service Desk creates or updates the article identified by `article_id + language`.
7. Deleted files should archive the corresponding Service Desk article by default instead of hard deleting it.
8. Synchronization results are written to the Service Desk integration log.

## Conflict handling

The initial implementation should use GitHub as authoritative content storage. Editing a GitHub-managed article directly in Service Desk should either be disabled or clearly marked as temporary.

For future bidirectional synchronization, use optimistic concurrency with both:

- Git commit SHA
- Service Desk article version

Conflicting edits must never silently overwrite one another.

## Publication rules

- `draft` -> do not expose to users
- `review` -> visible only to users with review permissions
- `published` -> expose according to `visibility`
- `archived` -> remove from normal search/navigation but retain history

## Visibility mapping

`public` may be exposed to customers and agents according to portal configuration.

`internal` is restricted to internal users/agents.

`restricted` requires explicit project, role or organization mapping in Service Desk.

## Webhook security

The integration should:

- validate GitHub webhook signatures
- accept events only for configured repositories and branches
- use a dedicated scoped credential for GitHub API calls
- implement replay/idempotency protection using GitHub delivery IDs
- never log secrets or authorization headers

## Failure behavior

A malformed article must not break synchronization of unrelated valid articles.

Failed items should be reported individually with filename, commit SHA and a safe validation/error message. Failed synchronization must be retryable.

## Deletes and renames

A rename is detected by stable `article_id`; it must not produce a second Service Desk article.

A deleted source file should archive its corresponding translation in Service Desk unless an administrator explicitly requests deletion.

## Future extensions

The schema is intended to support later additions such as attachments, related articles, ticket suggestions, approval workflow, article ownership, expiration/review dates and analytics without changing the stable article identity model.
