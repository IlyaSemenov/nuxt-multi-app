---
"nuxt-multi-app": patch
---

Fix `nuxt build` failing for applications with prerendered routes. During prerendering, `dispatch()` serves calls to the prerendering application and throws for other applications.
