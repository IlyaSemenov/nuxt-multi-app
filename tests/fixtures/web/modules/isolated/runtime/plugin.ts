export default defineNuxtPlugin({
  name: "fixture-isolated-plugin",
  setup() {
    return { provide: { isolated: "ISOLATED_PLUGIN" } }
  },
})
