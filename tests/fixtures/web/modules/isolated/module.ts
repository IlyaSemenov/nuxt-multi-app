import { addComponent, addPlugin, createResolver, defineNuxtModule, useNuxt } from "nuxt/kit"

export default defineNuxtModule({
  meta: { name: "fixture-isolated-module" },
  setup() {
    const resolver = createResolver(import.meta.url)
    addComponent({ name: "IsolatedBadge", filePath: resolver.resolve("./runtime/badge.vue") })
    addPlugin(resolver.resolve("./runtime/plugin"))
    useNuxt().options.css.push(resolver.resolve("./runtime/style.css"))
  },
})
