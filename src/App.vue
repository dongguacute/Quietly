<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <header>
    <span class="title">Quietly</span>
  </header>

  <main>
    <RouterView />
  </main>
</template>

<style scoped>
header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e5e5;
}

.title {
  font-weight: 600;
  color: #2c3e50;
}

main {
  padding: 1.5rem;
}
</style>
