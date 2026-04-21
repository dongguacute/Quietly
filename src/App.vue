<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <header>
    <nav>
      <RouterLink to="/">首页</RouterLink>
      <RouterLink to="/about">关于</RouterLink>
    </nav>
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

nav {
  display: flex;
  gap: 1rem;
}

nav a {
  color: #2c3e50;
  text-decoration: none;
}

nav a.router-link-active {
  font-weight: 600;
  color: #42b883;
}

main {
  padding: 1.5rem;
}
</style>
