import { defineNuxtPlugin } from "nuxt/app"

export default defineNuxtPlugin(() => ({ provide: { mountedOnly: "mounted" as const } }))
