# iTELade Knowledge Base 0.5.1 — Core hardening

0.5.1 is a security and persistence hardening release for the new 0.5 Confluence Core.

Data schema remains **1**. No data migration is required.

## Visibility hardening

- Anonymous users can no longer read `internal` or `restricted` pages even when those pages belong to a public space.
- Permission-aware search follows the same boundary.
- Service Desk API tokens now evaluate both the page visibility and the owning space visibility.
- A token granted only public knowledge cannot infer or retrieve internal pages.

## Space navigation

- Space tree responses now include effective `canEdit` and `canAdmin` flags.
- The frontend can therefore display Create page and Space settings actions consistently after opening a space.

## Persistence

- Recent-page history writes now go through the same serialized mutation/persistence queue as all other state changes.
- Existing corrupt `knowledge-base.json` data fails startup closed instead of being silently replaced with a new empty installation.
- A fresh installation is initialized only when the state file is genuinely absent.
- Data schema remains 1.

## Attachments

- User-controlled attachments are returned as forced downloads rather than inline same-origin content.
- Attachment responses include a sandbox Content-Security-Policy and no-referrer policy.
- Existing page authorization is still re-evaluated on every download.

## HTTP hardening

- API/static responses add a same-origin referrer policy where appropriate.
- Authentication login audit persistence is serialized instead of using a detached state write.

## Regression coverage

The application test suite now additionally verifies:

- effective space tree edit/admin permissions,
- anonymous denial for internal content in public spaces,
- permission-aware anonymous search,
- Service Desk token visibility boundaries,
- forced/sandboxed attachment downloads,
- fail-closed startup for corrupt persistent state.
