// Mounted into the child, where its package imports still resolve from the root's directory.
import { defineEventHandler } from "h3"
import { version } from "version-probe"

export default defineEventHandler(() => ({ version }))
