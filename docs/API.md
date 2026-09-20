# Knowledge Base integration API — 0.5.0

The `/api/v1/*` interface is intended for iTELade Service Desk and other server-to-server consumers.

## Authentication

Create an API token in **Administration → API tokens**.

Send the secret as:

```http
Authorization: Bearer kb_<secret>
```

The secret is shown once. Only its SHA-256 digest is persisted by Knowledge Base.

## Scopes

- `health` — integration health endpoint
- `search` — permission-aware knowledge search
- `read` — retrieve a full page by stable page ID

Tokens can optionally include visibility access for `internal` and, when explicitly needed, `restricted` pages.

## Health

```http
GET /api/v1/health
```

Example response:

```json
{
  "ok": true,
  "service": "iTELade Knowledge Base",
  "version": "0.5.0",
  "schemaVersion": 1
}
```

## Search

```http
GET /api/v1/search?q=vpn&language=en
```

Response fields include:

- stable page `id`
- `title`
- `summary`
- `spaceId`
- `labels`
- `language`
- `status`
- `visibility`
- `updatedAt`
- relevance `score`

Only published, non-archived content allowed by the token is returned.

## Page detail

```http
GET /api/v1/pages/:pageId
```

The stable `pageId` is independent from the page title and slug. Service Desk should persist this ID when linking an article to a ticket.

Returned page fields include raw safe Markdown and rendered HTML together with space metadata, language, labels, lifecycle and visibility metadata.

## Error handling

Typical responses:

- `401` — token missing, invalid, revoked or missing required scope
- `404` — page does not exist or is outside token visibility
- `500` — unexpected Knowledge Base failure

The API intentionally returns `404` for inaccessible page IDs so callers cannot infer restricted content.

## Suggested Service Desk integration

1. Configure the Knowledge Base base URL and token in Service Desk.
2. Test `/api/v1/health`.
3. When an agent types in the knowledge picker, call `/api/v1/search` with ticket title/keywords.
4. Store selected stable page IDs on the Service Desk side.
5. Resolve display metadata using `/api/v1/pages/:pageId` when opening a linked article.
6. Cache display metadata briefly, but re-check the page before presenting protected content.

Knowledge Base should remain authoritative for page access, lifecycle and content.
