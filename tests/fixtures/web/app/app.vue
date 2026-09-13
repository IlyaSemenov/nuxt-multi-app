<script setup lang="ts">
const count = ref(0)
const { $instance, $isolated } = useNuxtApp()
</script>

<template>
  <main id="app" data-instance="web">
    <h1>WEB_HMR_0</h1>
    <p id="instance">{{ $instance }} / {{ $isolated }}</p>
    {{ useChildLabel() }}
    <ChildMarker />
    <IsolatedBadge />
    <button type="button" @click="count++">Count {{ count }}</button>
  </main>
</template>
