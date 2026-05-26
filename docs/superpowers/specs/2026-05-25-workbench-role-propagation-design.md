# Workbench Role Propagation Design

## Goal

Make the review workbench preserve the active mock role across all API calls and enforce reviewer-only mutation paths on both client and server.

## Scope

This slice adds:

- `x-finproof-role` headers to workbench support-data and mutation requests.
- UI disabling for reviewer-only workbench mutations when the active role is `requester`.
- Server-side RBAC for opinion draft generation and saving.
- Tests for requester-denied draft/finalize flows and reviewer header propagation.

This slice does not replace mock header auth with real auth sessions.

## Rules

- `reviewer` and `compliance_admin` can save issue decisions, generate/save opinion drafts, generate reports, and finalize review cases.
- `requester` can read the workbench and audit/status data but cannot mutate reviewer decisions or opinion draft state.
- Client-side disabling is an affordance only. Server route/service checks remain authoritative.

## Architecture

`ReviewDetailWorkspace` reads `RoleContext` directly, falling back to `reviewer` for isolated tests and direct server-rendered detail pages. It builds request headers through local helper functions so all fetch calls include the current role consistently.

`ReviewService.saveOpinionDraft` uses the same `requireRole` pattern as issue decision and finalization. Draft routes catch RBAC errors with `jsonForbidden`, matching existing route conventions.

## Testing

- Extend route tests to assert requester draft generation and draft save return `403`.
- Extend component tests to assert reviewer workbench calls send `x-finproof-role`.
- Add requester rendering assertions for disabled reviewer-only controls.
