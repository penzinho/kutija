# Narodni Maksimir

Unofficial public gallery + people's vote for the 88 Maksimir stadium competition entries. Full spec: SPEC.md — read it before larger changes.

## Stack
Astro (static, TS strict) · Supabase (anonymous sessions, RPC, Edge Function `vote`) · Turnstile · Vercel · pnpm

## Rules
- Package manager: **pnpm only**. Never use npm or yarn, never create package-lock.json or yarn.lock. Use `pnpm add`, `pnpm dlx` (not npx), `pnpm create astro`.
- UI text in Croatian, code/comments in English.
- No login/accounts ever. Identity = invisible anonymous Supabase session.
- All vote writes go through the `vote` Edge Function → SECURITY DEFINER functions. Never allow direct client writes; keep RLS on.
- Never store raw IPs, only salted ip_hash.
- Styling: all design values live in src/styles/tokens.css. Don't hardcode colors/fonts in components — design comes from Claude Design later.
- Entry data lives only in src/data/entries.json (validated by zod). Images are imported via scripts/import-images.ts.
- Commit after each completed step. Ask before anything that costs money or needs a paid plan.

## Commands
- install: `pnpm install`
- dev: `pnpm dev`
- check: `pnpm check` (astro check; needs TypeScript 6, not 7)
- build: `pnpm build`
- images: `pnpm tsx scripts/import-images.ts <folder>`
- db (remote project srqdfixcngwpfwllljse, no local Docker): `pnpm dlx supabase db push`, tests `pnpm dlx supabase db query --linked -f supabase/tests/voting.sql`