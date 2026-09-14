# iTELade Service Desk Knowledge Base

Central knowledge base repository synchronized with **iTELade Service Desk**.

English is the primary language. Polish is maintained as an additional supported language.

## Repository structure

```text
articles/
  en/
    getting-started/
    troubleshooting/
    administration/
    security/
  pl/
    getting-started/
    troubleshooting/
    administration/
    security/
config/
  categories.yml
  schema.yml
docs/
  SYNC.md
  AUTHORING.md
```

## Article format

Each article is a Markdown file with YAML front matter. Articles in different languages that describe the same subject share the same `article_id`.

```yaml
---
article_id: kb-0001
language: en
translation_of: null
status: published
visibility: public
category: getting-started
slug: welcome-to-service-desk
title: Welcome to iTELade Service Desk
summary: Basic introduction to iTELade Service Desk.
tags:
  - getting-started
  - service-desk
service_desk:
  sync: true
  project_keys: []
  article_key: null
updated_at: 2026-09-14
---
```

The Polish translation uses the same `article_id` and sets `translation_of: en`.

## Synchronization model

Service Desk should synchronize knowledge articles by `article_id`, not by filename. GitHub remains the version-controlled source for Markdown content, while Service Desk may keep its own internal record ID in `service_desk.article_key`.

See [`docs/SYNC.md`](docs/SYNC.md) for the synchronization contract.

## Workflow

1. Create or edit an article in this repository.
2. Validate its front matter and Markdown.
3. Merge the change into `main`.
4. Service Desk detects the new commit or receives a webhook.
5. Service Desk creates or updates the corresponding knowledge article.
6. Sync state and errors are recorded by Service Desk.

## Language policy

- Primary/default language: **English (`en`)**
- Additional supported language: **Polish (`pl`)**
- Missing translations should fall back to English.
- Additional languages can be added later without changing the article identity model.

## Status values

- `draft` — not visible to end users
- `review` — awaiting review
- `published` — visible according to `visibility`
- `archived` — retained for history but hidden from normal browsing

## Visibility values

- `public` — available to all users allowed to access the knowledge base
- `internal` — available only to agents/internal users
- `restricted` — visibility controlled by Service Desk project or role mapping

## Contribution

See [`docs/AUTHORING.md`](docs/AUTHORING.md) before adding new content.
