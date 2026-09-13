<script setup lang="ts">
const count = ref(0)
const { $instance } = useNuxtApp()
</script>

<template>
  <main id="app" data-instance="root">
    <h1>ROOT_HMR_0</h1>
    <p id="instance">{{ $instance }}</p>
    <button type="button" @click="count++">Count {{ count }}</button>
  </main>
</template>
