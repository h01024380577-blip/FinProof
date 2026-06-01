# Repository Guidelines

## Project Structure & Module Organization

FinProof Agent is a Next.js App Router, React, and TypeScript application. UI routes and HTTP handlers live in `src/app`, including `src/app/api/v1/**`. Shared UI is in `src/components`, with feature folders such as `queue`, `intake`, `workbench`, and `ui`. Framework-free business logic and types live in `src/domain`; side-effecting services, persistence, auth, analysis, knowledge, and storage code live in `src/server`. Test setup is in `src/test`, sample fixtures are in `src/data`, Prisma schema and migrations are in `prisma`, and deployment helpers are in `ops` and `scripts`.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start the Next.js Turbopack development server.
- `npm run build`: create a production build.
- `npm run start`: run the built production app.
- `npm run test`: run Vitest once in jsdom.
- `npm run lint`: run ESLint with `--max-warnings=0`.
- `npm run format`: check Prettier formatting.
- `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run db:smoke`: Prisma workflows for local persistence.

## Coding Style & Naming Conventions

Use strict TypeScript, React JSX, and the `@/*` path alias for imports from `src`. Keep tests colocated with source as `*.test.ts` or `*.test.tsx`. Prefer domain logic in `src/domain` when it can remain framework-free, and keep server-only side effects in `src/server`. Do not edit `src/generated/prisma` by hand; regenerate it with Prisma commands. Run `npm run format:write` before submitting broad formatting changes.

## Testing Guidelines

Vitest uses jsdom, globals, React Testing Library, and `src/test/setup.ts`. Add focused colocated tests for changed domain functions, components, route behavior, scripts, or store methods. For a single file, run `npx vitest run path/to/file.test.ts`; for one case, use `npx vitest run -t "test name"`. Run `npm run test` and `npm run lint` before opening a PR.

## Commit & Pull Request Guidelines

Recent commits use Conventional Commits such as `feat: ...` and `fix: ...`; keep subjects imperative and scoped to one change. PRs should include a concise summary, linked issue or context, testing performed, and screenshots for visible UI changes. Call out schema, environment, deployment, or migration impacts explicitly.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local configuration and never commit secrets or private keys. The default review store is mock data; use `FINPROOF_REVIEW_STORE=prisma` with Postgres only when testing persistence. Keep sample data opt-in with `FINPROOF_ENABLE_SAMPLE_DATA=true`.
