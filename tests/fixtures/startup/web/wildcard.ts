import { defineEventHandler } from "h3"

export default defineEventHandler((event) => `wildcard:${event.context.backend}`)
