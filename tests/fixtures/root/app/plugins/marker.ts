export default defineNuxtPlugin(() => {
  if (import.meta.client) document.documentElement.dataset.instance = "root"
  return {
    provide: { instance: "ROOT_PLUGIN" as const },
  }
})
