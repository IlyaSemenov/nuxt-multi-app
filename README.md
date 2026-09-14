# nuxt-multi-app

Run several independent Nuxt applications behind one HTTP server.

Each application keeps its own Nuxt configuration, modules, server routes, styles, assets, and generated types.
Routing selects one application to handle each request; pages load that application's browser bundle.

Use this when several Nuxt applications have to ship as a single service without merging their configurations.
It is not client-side microfrontend composition.

> This is a community module, not maintained by the Nuxt core team.
> Nuxt core tracks a broader [multi-app initiative](https://github.com/nuxt/nuxt/issues/21635); this package is independent of it.

## Status

Beta, tied to Nuxt `~4.5.2`.
The module builds on internal Nuxt, Nitro, and Vite APIs, so each Nuxt minor needs its own release.

## Installation

```sh
npm install nuxt-multi-app
```

## Quick start

One application is the root: its `dev` and `build` commands run the whole composition, and its server accepts incoming requests.

Add the module to the root application's `nuxt.config.ts`, declare the applications under `root` and `apps`, then list their routing rules under `routing`:

```ts
// apps/landing/nuxt.config.ts
export default defineNuxtConfig({
  modules: ["nuxt-multi-app"],

  multiApp: {
    root: { id: "landing" },
    apps: [{ id: "tenant", rootDir: "../tenant" }],
    routing: [
      { hosts: ["example.com", "www.example.com"], app: "landing" },
      { hosts: ["*.example.com"], app: "tenant" },
    ],
  },
})
```

Each application declares:

- `id`: unique name; the root may omit it and defaults to `root`;
- `rootDir`, children only: its directory relative to the root application.

A child loads its own `nuxt.config` and inherits nothing from the root — no modules, plugins, styles, routes, or dependencies.

## Routing rules

`nuxt-multi-app` runs `multiApp.routing` from top to bottom and uses the first rule that selects an application.
Alternatives inside `hosts` or `paths` use OR semantics, while distinct fields in one rule use AND semantics.
A rule with only `app` matches every request that reaches it.
If no rule selects an application, the built-in response is 404.

The selected application handles its pages, assets, API routes, HMR, and WebSocket upgrades.

In the quick start, `example.com` and `www.example.com` go to `landing`, subdomains go to `tenant`, and every other host gets a 404.

### Route by hostname

Use a `hosts` rule when you know the domains at build time:

```ts
{ hosts: ["example.com", "*.example.com"], app: "landing" }
```

You can write an exact hostname, `example.com`, or a leading wildcard, `*.example.com` — it covers `blog.example.com`, but not `example.com` itself.
Matching ignores case and the port.

### Route by path

Use a `paths` rule when an application owns a complete URL namespace:

```ts
{
  paths: ["/api", "/_e2e"],
  app: "tenant",
}
```

`/api` matches `/api` and every path below `/api/`, but not `/apiary`.
The server compares the raw pathname without its query string and without decoding or normalizing path segments.
A trailing slash in configuration is ignored.

Add both guards to require a host and a path match:

```ts
{
  hosts: ["admin.example.com"],
  paths: ["/internal"],
  app: "admin",
}
```

Do not route a single HTML path this way: the page's assets and HMR requests live under different paths and would still go elsewhere.

### Route with a resolver

`nuxt build` bakes the ordered routing rules into the output.
Use a resolver when hostnames are known only at runtime, such as when the same `.output` runs in e2e, staging, and production environments:

```ts
// apps/landing/multi-app-resolver.ts
import { defineMultiAppResolver } from "nuxt-multi-app"

export default defineMultiAppResolver(() => {
  const landingHost = new URL(import.meta.env.APP_BASE_URL!).hostname
  return (host) => (host === landingHost ? "landing" : "tenant")
})
```

```ts
multiApp: {
  routing: [
    { resolver: "./multi-app-resolver.ts" },
  ],
}
```

The outer function runs once at startup.
The function it returns runs when a request reaches the resolver rule and its guards match.
Startup gets `appIds`, the set of configured IDs — check it if you want a misconfigured project to fail before the server takes traffic.

Per request, return:

- an application ID to route there;
- `undefined` to continue with the next rule;
- `false` to answer as if nothing matched.

A resolver rule may also have `hosts` and `paths` guards.
If a guard does not match, the resolver is not called; if every guard matches, the resolver decides according to the return values above.

**Caveat.** Startup happens before any application boots, so the file can use `import.meta.env` and ordinary project modules, but no Nuxt composables.

## Configuring child applications

A child starts from its own `nuxt.config`.

Add `overrides` to an `apps` entry to apply configuration only while the child runs under the root, such as an alias that resolves differently in standalone mode, or a Nuxt layer that the root owns:

```ts
{
  id: "tenant",
  rootDir: "../tenant",
  overrides: {
    alias: {
      "#tenant-backend": fileURLToPath(new URL("./server/tenant-backend.ts", import.meta.url)),
    },
    extends: [fileURLToPath(new URL("./layers/shared-account", import.meta.url))],
  },
}
```

`overrides` reaches the child exactly as written: Nuxt resolves relative paths in it from the child's directory and leaves alias values alone, so write paths as absolute.

### Generated types

`nuxt prepare` writes type files for the root and every child without building bundles.

A mounted child generates into `<child-root>/.nuxt-multi-app/<app-id>`, beside the `.nuxt` directory of its standalone build, so both type setups can exist at once.

Ignore it in Git:

```gitignore
**/.nuxt-multi-app/
```

If the repository type-checks generated Nuxt projects, add one TypeScript project per mounted child.
In the quick start it extends `apps/tenant/.nuxt-multi-app/tenant/tsconfig.json`.

Resolver and state-handler files are added to the root's generated `tsconfig.node.json`, and `event.context.nuxtMultiApp` is typed in every application's Nitro types.
Running `nuxt prepare` also generates the configured application IDs, so resolver results, `dispatch()`, and `createFetch()` reject unknown IDs during type checking.

Set `multiApp.buildDir` to rename that directory for every child, or `buildDir` on a single `apps` entry to move one child; both are resolved from the child root.

## Calling another application during SSR

A page rendered by one application sometimes needs an API route that belongs to another one.
`event.context.nuxtMultiApp.dispatch()` calls it without a public round trip:

```ts
export default defineEventHandler(async (event) => {
  const request = new Request(new URL("/api/rpc/posts", getRequestURL(event)), {
    method: "POST",
    headers: {
      cookie: getHeader(event, "cookie") ?? "",
      "content-type": "application/json",
    },
    body: JSON.stringify({ title: "Hello" }),
  })

  return event.context.nuxtMultiApp.dispatch("tenant", request, {
    signal: event.context.nuxtMultiApp.signal,
  })
})
```

`dispatch(id, request, options?)` takes the target application's `id` and a Web `Request`, and returns that application's Web `Response` with a streaming body.
Routing happens by `id` alone: the URL's origin never selects the target and never reaches the public network, so reuse the incoming one instead of inventing a hostname.

Nothing is forwarded implicitly.
Cookies, authorization, tracing, and the original Host header travel only when you set them on the outgoing request.

- An unknown ID throws.
- A target that cannot take the call answers 503 with `Retry-After: 1`: in development while it is still booting, in production only during shutdown.
- The call is cancelled when its signal aborts or the server starts shutting down.

Use `createFetch(id, options?)` when the caller is a client library configured with a `fetch` function: it builds the `Request` for you and dispatches it to that application.

```ts
const fetch = event.context.nuxtMultiApp.createFetch("tenant")
const response = await fetch(new URL("/api/rpc/posts", getRequestURL(event)), { method: "POST" })
```

Everything above still applies, and the call aborts with the incoming request; a `signal` on `createFetch()` or on the call itself narrows that.

In development the call crosses a private local socket; in production it reaches the target's Nitro handler inside the same process.

Both live on the server event, so neither reaches the browser.
Browser requests arrive at the owning application through the configured routing rules instead.

## Readiness endpoint

Set `readinessPath` to add a readiness endpoint at that path:

```ts
multiApp: {
  readinessPath: "/__app/ready",
}
```

The server answers it before routing, and reports whether every application has finished loading: 200 with `{"ready":true}` when they all have, 503 while one is still starting or has failed.

This mostly helps in development and in tests, where applications load in the background while the server already accepts requests.
In production every application loads before the server listens, so a server that answers at all is ready.

Set `multiApp.debug` to add a per-application breakdown to the body.

## Error responses

When no routing rule selects an application, the built-in response is 404; a resolver failure produces 500.
Development adds 503 while an application is still booting and 500 after one has failed.

Set `stateHandler` to replace those responses with your own:

```ts
// apps/landing/multi-app-state-handler.ts
import { defineMultiAppStateHandler } from "nuxt-multi-app"

export default defineMultiAppStateHandler(() => (state, _request, response) => {
  const failed = state.type === "failed" || state.type === "resolver-error"
  response.statusCode = state.type === "unmatched" ? 404 : failed ? 500 : 503
  response.end(state.type)
})
```

```ts
multiApp: {
  stateHandler: "./multi-app-state-handler.ts",
}
```

The outer function runs once at startup, and the file and its dependencies are bundled into the production output.
The handler it returns answers:

- `unmatched`: no application matched the request;
- `resolver-error`: the resolver threw;
- `starting`: the application is still loading (development only);
- `closing`: the application is shutting down (development only);
- `failed`: the application failed to load (development only).

## Running in development

Run `nuxt dev` on the root application; it starts every child behind the same server:

```sh
npx nuxt dev apps/landing
```

Each application gets its own Vite and Nitro instance, and serves its own pages, server routes, and HMR.
Editing a child's `nuxt.config` restarts every mounted application.

Vite checks hostnames after routing, not before.
If a custom development hostname comes back as `403 Blocked request`, add it to `vite.server.allowedHosts` of the application that handles it.

## Building for production

Run `nuxt build` on the root application; it builds every child and writes one process entry to run:

```sh
npx nuxt build apps/landing
npx nuxt preview apps/landing
# or: node apps/landing/.output/server/index.mjs
```

Everything lands in the root application's `.output`:

```text
.output/
├── nitro.json           # Nitro build metadata and preview command
├── server/index.mjs     # process entry point
└── nuxt-multi-app/
    ├── apps/<app-id>/   # Nitro bundle and public assets for every application
    └── manifest.json    # routing configuration the server reads
```

The root application uses the same `nuxt-multi-app/apps/<app-id>` layout as its children.
The standard Nitro entry combines those isolated outputs behind one server process.

The entry listens on `NITRO_PORT` or `PORT`, default `3000`, and on `NITRO_HOST` or `HOST` when one is set, like Nitro's `node-server` preset.

On `SIGINT` or `SIGTERM` the server stops accepting requests, gives active responses and dispatch calls up to `shutdownTimeout` to finish, and then closes every application.

## Module options

| Option            | Description                                                            | Default           |
| ----------------- | ---------------------------------------------------------------------- | ----------------- |
| `root`            | ID for the root application.                                           | `{ id: "root" }`  |
| `apps`            | Child applications to load.                                            | `[]`              |
| `buildDir`        | Generated directory for mounted children, relative to each child root. | `.nuxt-multi-app` |
| `routing`         | Non-empty ordered application and resolver rules.                      | —                 |
| `stateHandler`    | Path to a custom error-response file.                                  | —                 |
| `readinessPath`   | Path of a readiness endpoint answered before routing.                  | —                 |
| `shutdownTimeout` | Maximum shutdown wait in milliseconds.                                 | `30000`           |
| `debug`           | Log request routing and application lifecycle events.                  | Nuxt `debug`      |

`root` accepts only `id` and always refers to the Nuxt application that loads the module.

## Isolation and limitations

Applications share nothing that is built: configuration, module instances, generated files, client assets, Nitro bundles, and production dependency copies are separate.

They do share one operating-system process, and with it `process.env`, `globalThis`, signal handlers, and native resources.
Anything installing process-wide hooks, such as some observability SDKs, has to run once rather than once per application.

`nitro.externals.trace: false` is rejected because it lets applications share server dependency instances.

Supported Nitro presets are `node`, `node-listener`, and `node-server`.
`node-cluster`, serverless and edge presets, prerender-only output, HTTPS termination inside Nitro, and multiple public listeners are out of scope.

The generated server is tested on Node.
It may run on Bun through Bun's Node compatibility layer, but Bun is not part of the integration test matrix.

The integration suite runs on Linux in CI; Windows is not tested.
