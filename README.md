# nuxt-multi-app

Run several independent Nuxt applications behind one HTTP server.

The server routes every request to exactly one application, by hostname or by your own routing code.
That application keeps its own Nuxt configuration, modules, server routes, styles, assets, and generated types, and owns the entire response and browser bundle for the page.

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

One application is the root: you run its `dev` and `build` commands, and its HTTP server accepts every incoming request.

Add the module to the root application's `nuxt.config.ts`, then describe the root under `root` and every other application under `apps`:

```ts
// apps/landing/nuxt.config.ts
export default defineNuxtConfig({
  modules: ["nuxt-multi-app"],

  multiApp: {
    root: {
      id: "landing",
      hosts: ["example.com", "www.example.com"],
    },
    apps: [
      {
        id: "tenant",
        rootDir: "../tenant",
        hosts: ["*.example.com"],
      },
    ],
    fallback: "tenant",
  },
})
```

Each application declares:

- `id`: a name, unique across the configuration;
- `hosts`: hostnames the application answers on;
- `rootDir`: for a child application, its directory relative to the root application.

A child loads its own `nuxt.config` and inherits nothing from the root — no modules, plugins, styles, routes, or dependencies.

## Routing requests

`nuxt-multi-app` routes each request to a single application.
To pick it, the server tries in order:

1. the resolver from `multiApp.resolver`, if the project has one;
2. the `hosts` patterns of every application;
3. the `fallback` application.

If that turns up nothing, the request gets a 404.

That application then handles everything for the request: the page, its assets, API routes, HMR, and WebSocket upgrades.

### Route by hostname

Use `hosts` when you know the domains at build time.

You can write an exact hostname, `example.com`, or a leading wildcard, `*.example.com` — it covers `blog.example.com`, but not `example.com` itself.
Matching ignores case and the port.
When several applications match, the root wins, then children in configuration order.

`fallback` catches everything else; its default `false` means 404.

In the quick start, `example.com` and `www.example.com` go to `landing`, subdomains go to `tenant`, and any other host falls back to `tenant`.

### Route with a resolver

`nuxt build` bakes the module configuration, `hosts` included, into the output.
Use a resolver when one `.output` has to serve different domains — e2e, staging, production — depending on the environment the server starts in:

```ts
// apps/landing/multi-app-resolver.ts
import { defineMultiAppResolver } from "nuxt-multi-app"

export default defineMultiAppResolver(() => {
  const landingHost = new URL(process.env.APP_BASE_URL!).hostname
  return (host) => (host === landingHost ? "landing" : "tenant")
})
```

```ts
multiApp: {
  resolver: "./multi-app-resolver.ts",
}
```

The outer function runs once at startup, and the function it returns runs for every request.
Startup gets `appIds`, the set of configured IDs — check it if you want a misconfigured project to fail before the server takes traffic.

Per request, return:

- an application ID to route there;
- `undefined` to fall through to `hosts` and `fallback`;
- `false` to answer as if nothing matched.

**Caveat.** Startup happens before any application boots, so the file can use `process.env` and ordinary project modules, but no Nuxt composables and no `import.meta.env`.

### Route by path

A resolver also gets the incoming Node request, so it can send a whole API namespace to another application:

```ts
export default defineMultiAppResolver(
  () => (host, request) => (request.url?.startsWith("/api/rpc/") ? "tenant" : undefined),
)
```

**Warning.** Do not route a single HTML path that way: the page's assets and HMR requests live under different paths and would still go elsewhere.

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

The resolver and state-handler files are added to the root's generated `tsconfig.node.json` for you, and `event.context.nuxtMultiApp` is typed in every application's Nitro types.

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
Browser requests arrive at the owning application through `hosts` or the resolver instead.

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

When no application serves a request, the built-in answers are 404 for no match and 500 when the resolver fails.
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
node apps/landing/.output/nuxt-multi-app/server.mjs
```

Everything lands in the root application's `.output`:

```text
.output/
├── public/              # root application's public assets
├── server/              # root application's Nitro bundle
└── nuxt-multi-app/
    ├── apps/<app-id>/   # Nitro bundle and public assets per child
    ├── manifest.json    # routing configuration the server reads
    ├── report.json      # what was built and how requests are routed
    └── server.mjs       # process entry point
```

The root application keeps the ordinary Nitro output it would have built on its own, and the entry imports it as one more application.

The entry listens on `NITRO_PORT` or `PORT`, default `3000`, and on `NITRO_HOST` or `HOST` when one is set, like Nitro's `node-server` preset.

On `SIGINT` or `SIGTERM` the server stops accepting requests, gives active responses and dispatch calls up to `shutdownTimeout` to finish, and then closes every application.

## Root configuration

| Option            | Description                                                            | Default           |
| ----------------- | ---------------------------------------------------------------------- | ----------------- |
| `root`            | ID and static hosts for the root application.                          | `{ id: "root" }`  |
| `apps`            | Child applications to load.                                            | `[]`              |
| `buildDir`        | Generated directory for mounted children, relative to each child root. | `.nuxt-multi-app` |
| `resolver`        | Path to a runtime resolver file.                                       | —                 |
| `fallback`        | Application ID used when no resolver or host matches, or `false`.      | `false`           |
| `stateHandler`    | Path to a custom error-response file.                                  | —                 |
| `readinessPath`   | Path of a readiness endpoint answered before routing.                  | —                 |
| `shutdownTimeout` | Maximum shutdown wait in milliseconds.                                 | `30000`           |
| `debug`           | Log request routing and application lifecycle events.                  | Nuxt `debug`      |

`root` takes only `id` and `hosts`: its directory and Nuxt configuration are those of the application that loads the module.

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
