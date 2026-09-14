/** Default export of a project module: initializes and returns the runtime function. */
type Factory<T> = () => T | Promise<T>

/**
 * Import a bundled project module and initialize its default-exported factory once at startup.
 *
 * `name` identifies the module in error messages.
 */
export async function loadFactory<T extends (...args: never[]) => unknown>(
  url: string,
  name: string,
): Promise<T> {
  const module = (await import(url)) as { default?: unknown }
  if (typeof module.default !== "function") {
    throw new TypeError(`nuxt-multi-app: ${name} module must default-export a factory function`)
  }
  return initializeFactory(module.default as Factory<T>, name)
}

/** Run a project factory once and reject anything but a function as its result. */
export async function initializeFactory<T extends (...args: never[]) => unknown>(
  factory: Factory<T>,
  name: string,
): Promise<T> {
  let initialized: T
  try {
    initialized = await factory()
  } catch (cause) {
    throw new Error(`nuxt-multi-app: ${name} initialization failed`, { cause })
  }
  if (typeof initialized !== "function") {
    throw new TypeError(`nuxt-multi-app: ${name} factory must return a function`)
  }
  return initialized
}
