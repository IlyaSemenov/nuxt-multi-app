# nuxt-multi-app

## 0.4.0

### Minor Changes

- f0ee00a: Place child build directories under `.nuxt/multi-app`.

## 0.3.0

### Minor Changes

- 748d04a: Generate a TypeScript solution that checks every Nuxt project in the composition with one command.

### Patch Changes

- cdd7387: Show configured application IDs as a literal union in TypeScript diagnostics.

## 0.2.1

### Patch Changes

- d080281: Keep late Nitro output mutations attached to the root application handler instead of the multiplexer.

## 0.2.0

### Minor Changes

- 6ba4714: Replace application-level routing fields with an ordered `routing` list whose host and path guards can select an application or invoke a resolver.
- 93fdf75: Remove the unused startup context argument from resolver and state-handler factories.
- 1b5c2fa: Write the multiplexer to the standard Nitro server entry, make `nuxt preview` launch it, and store the root Nitro output beside mounted applications.
- 5cd1982: Generate configured application ID types for resolvers, dispatch, and bound fetch clients during `nuxt prepare`.

### Patch Changes

- 3c5b3a3: Expose runtime environment variables through `import.meta.env` in bundled resolver and state-handler modules.

## 0.1.2

### Patch Changes

- faffa6c: Make `@types/node` a peer dependency, and widen supported range.

## 0.1.1

### Patch Changes

- c4dad32: Give a mounted application the global Nuxt Kit context while it loads, so its modules register into it instead of the root application.
- 23120ae: Report the fallback in the startup routing line instead of a separate line that read like a request log.

## 0.1.0

### Minor Changes

- a55a583: Initial beta release.
