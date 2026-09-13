/**
 * Initialize and validate a project resolver exactly once during server startup.
 *
 * @param {import("../options").MultiAppResolverFactory} factory
 * @param {string[]} appIds
 * @returns {Promise<import("../options").MultiAppResolver>}
 */
export async function initializeResolver(factory, appIds) {
  return initializeFactory(factory, appIds, "resolver")
}

/**
 * Initialize and validate a project state handler exactly once during server startup.
 *
 * @param {import("../options").MultiAppStateHandlerFactory} factory
 * @param {string[]} appIds
 * @returns {Promise<import("../options").MultiAppStateHandler>}
 */
export async function initializeStateHandler(factory, appIds) {
  return initializeFactory(factory, appIds, "state handler")
}

async function initializeFactory(factory, appIds, name) {
  let initialized
  try {
    initialized = await factory({ appIds: new Set(appIds) })
  } catch (cause) {
    throw new Error(`nuxt-multi-app: ${name} initialization failed`, { cause })
  }
  if (typeof initialized !== "function") {
    throw new TypeError(`nuxt-multi-app: ${name} factory must return a function`)
  }
  return initialized
}
