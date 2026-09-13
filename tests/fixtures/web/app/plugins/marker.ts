export default defineNuxtPlugin(() => {
  if (import.meta.client) document.documentElement.dataset.instance = "web"
  return { provide: { instance: "WEB_PLUGIN" as const } }
})
