# Authoring guide

## General rules

- Write English first. English is the canonical/default language.
- Add Polish as a separate translation using the same `article_id`.
- Use clear Markdown and short sections.
- Do not place passwords, tokens, private keys, personal data or internal secrets in articles.
- Prefer stable product terminology used in iTELade Service Desk.

## Creating a new article

1. Choose the next available stable `article_id`, for example `kb-0002`.
2. Create the English file under `articles/en/<category>/`.
3. Add complete YAML front matter.
4. Set `translation_of: null` for the English source.
5. Create the Polish translation under `articles/pl/<category>/` when available.
6. Use the same `article_id` in both languages.
7. Set `translation_of: en` in the Polish file.
8. Keep both translations semantically aligned.

## Front matter example

```yaml
---
article_id: kb-0002
language: en
translation_of: null
status: draft
visibility: public
category: troubleshooting
slug: cannot-sign-in
title: Cannot sign in
summary: Steps to diagnose common sign-in problems.
tags:
  - authentication
  - troubleshooting
service_desk:
  sync: true
  project_keys: []
  article_key: null
updated_at: 2026-09-14
---
```

## Slugs

Use lowercase ASCII slugs with hyphens, for example:

- `welcome-to-service-desk`
- `cannot-sign-in`
- `configure-ldap`

The slug may change in the future. The permanent identity is `article_id`.

## Categories

Use only categories defined in `config/categories.yml`.

## Status workflow

Recommended lifecycle:

`draft` -> `review` -> `published` -> `archived`

Do not publish unfinished instructions merely to test synchronization.

## Translation policy

English is the fallback language. A Polish translation may be published later than the English source. Service Desk should fall back to English if the requested translation is unavailable.

When the meaning of an English article changes substantially, update its translations in the same pull request where practical.

## Images and attachments

A future attachment convention may be added under `assets/<article_id>/`. Until that is formally implemented in the Service Desk sync layer, avoid depending on repository-relative binary attachments for critical instructions.
