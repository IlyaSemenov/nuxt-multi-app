# nuxt-multi-app Agent Guide

## Overview

Serve several independent Nuxt applications from one dev server and one production process.

Read [README.md](README.md) completely before changing the public API, package behavior, supported runtimes, or user documentation.

Extend this guide only with stable, non-obvious conventions, architecture, contracts, workflows, and gotchas.
Do not catalog files or restate information evident from their names and locations.

## Scope

- Keep production code in `src/`.
- Keep focused module tests beside their source as `*.test.ts`.
- Keep runtime integration, package-boundary, and type-inference tests in `tests/`.
- Name compile-only tests `*.type-test.ts`.
- Keep the root module entry limited to explicit public exports and module registration.
- Treat `package.json` exports, module options, generated output layout, and supported runtimes as public contracts.
- Keep project-specific routing, authentication, tenant, RPC, database, and E2E knowledge outside this package.

## Architecture

- Route a request once, before consuming its body, by running routing rules in configuration order.
- Treat application IDs as allowlisted registry keys; never derive a dispatch target from request headers or URLs.
- Keep browser requests on the public listener and expose dispatch only on the per-request server context.
- Preserve the caller's headers and Host as request data without forwarding any additional headers automatically.
- Keep each child configuration independent; only documented mount overrides may cross from the root into a child.
- Run production handlers, internal fetches, and close hooks inside the target application's async-local context.
- Load a mounted application while it owns the global Kit context, and hand that context back afterwards; load children one at a time so the owner is never shared.
- Reject build settings that defeat the documented module-instance isolation guarantee.
- Keep Nuxt, Nitro, and Vite private API adaptations in `src/compat.ts`.
- Embed each application's Vite bridge options as literals in its Nitro bundle, including after renaming the bridge's `process` import.
- Close children through their Nuxt lifecycle and prevent starts or forwarded restarts once their generation begins closing.
- Register loaded child and layer configuration files with the child's native builder watcher before building.
- Keep `src/runtime/` free of imports from outside it, including type-only imports; declare contracts it shares with build-time code inside `src/runtime/`.
- Keep the value imports of `src/runtime/server.ts` and of the runtime files it uses limited to Node built-ins and sibling `src/runtime/` files; `src/build.ts` bundles the built entry with esbuild into portable output.

## Documentation

- Write public README and JSDoc text for package users who do not know the implementation.
- Add JSDoc to every exported declaration and to internal helpers whose contract, inputs, output, or failure behavior is not obvious.
- Add inline comments beside every non-obvious invariant, algorithmic choice, safety constraint, and intentionally limited behavior.
- Update nearby JSDoc and inline comments whenever the documented code changes, and remove comments that no longer apply.
- Do not narrate self-evident syntax or restate what a name already communicates.
- Name public composition services `MultiApp*`, single-application types `App*`, root configuration `Root*`, and Nitro request-context injections `NuxtMultiApp*`; keep `ModuleOptions` for the Nuxt module convention.
- Use One Sentence Per Line for connected prose.
- Keep semantically connected explanations as prose paragraphs.
- Use lists for separate assertions instead of presenting them as prose paragraphs.

## Changesets

- Before the first publication, update `.changeset/initial-release.md` instead of creating additional changesets.
- After the first publication, add one `.changeset/*.md` file for each independently releasable user-visible change.
- Do not add changesets for internal refactors, maintenance, tests, or documentation changes that do not require a package release.
- Choose the SemVer bump from the public contract: `patch` for backward-compatible fixes, `minor` for backward-compatible functionality, and `major` for breaking changes.
- Do not edit the package version or `CHANGELOG.md` by hand, and do not run `changeset version` or `changeset publish`; the release workflow consumes pending changesets.

## Tests

- Exercise routing priority, unknown resolver IDs, explicit fallbacks, path-only dispatch, headers, streaming backpressure, cancellation, readiness, shutdown races, owner reload, Windows/TCP fallback, and packed-package use through their public boundaries.
- Cover both applications in a real browser for hydration, isolated modules and styles, client HMR, overlapping asynchronous builder hooks, server reload, and full Nuxt restart.
- Run Nuxt integration checks against the packed archive in an isolated consumer, not against the source directory.
- Keep tests deterministic so a failure repeats on every run.
- Verify that Nitro reload preserves Vite snapshots and full Nuxt restart replaces them, removes old IPC sockets, and closes the old Vite watchers and HMR clients.
- After CLI SIGINT, verify that old IPC endpoints reject connections and a fresh dev server starts; require IPC file removal on full Nuxt restart.
- Own the Nuxt CLI process tree in integration tests and terminate it before removing a failed consumer workspace.

## Checks

- Run the `types` script when public types or TypeScript configuration change.
- Run the `test` script when behavior changes.
- Run the `build` script when package exports, declarations, or supported runtimes change.
- Run `test:nuxt` when changing Nuxt compatibility, plugin injection, dev routing, production output, dispatch, HMR, or WebSockets.
