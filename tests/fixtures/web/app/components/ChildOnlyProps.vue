<script setup lang="ts">
// The compiler resolves this auto-imported type through the child's generated declarations.
defineProps<ChildOnlyProps>()
</script>

<template>
  <span id="child-only-props">{{ label }}</span>
</template>
