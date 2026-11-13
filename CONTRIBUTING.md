# Contributing to @udinmoinc/gateway

Thanks for your interest. This project is maintained by **Vijay Singh**
(Udinmo Inc).

## Ground rules

- **Zero runtime dependencies.** The gateway runs on Node built-ins and
  global `fetch` only. Do not add runtime deps; devDependencies are fine.
- **Strict TypeScript.** `strict`, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
  are all on. No `any`, no `@ts-ignore`/`@ts-expect-error`.
- **Auth-agnostic core.** No authentication, sessions, users, roles, or
  tenants in `src/`. Domain logic enters via `EdgeGuard`s,
  `ProtectionProvider`s, `ctx.tags`, and plugins.
- **Validation at the boundary.** Plain-string shorthands are accepted in
  config but normalized/validated once at boot into branded internal types.

## Development

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # tsup → dist/ (ESM + CJS + .d.ts)
npm pack --dry-run  # verify published file set
```

## Pull requests

1. Keep changes focused; match existing code style (compact, no
   unnecessary comments).
2. Add or update tests under `tests/` for behavior changes.
3. Ensure `npm run typecheck`, `npm test`, `npm run build`, and
   `npm pack --dry-run` all pass before opening a PR.
4. Update `README.md` if public API or config surface changes.

## Security issues

Please report vulnerabilities privately to the maintainers rather than
opening a public issue.
