import { useLogger } from "@nuxt/kit"

/** Tagged logger for module, development, and build output; the production entry logs on its own. */
export const logger = useLogger("nuxt-multi-app")
