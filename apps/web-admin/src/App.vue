<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">Tele Auto Upload Admin</div>
      <nav>
        <RouterLink to="/dashboard">Dashboard</RouterLink>
        <RouterLink to="/messages">Messages</RouterLink>
        <RouterLink to="/histories">Histories</RouterLink>
      </nav>
      <div class="token-wrap">
        <input v-model="token" type="text" placeholder="Bearer token" @change="saveToken" />
      </div>
    </header>

    <main class="page-wrap">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { getToken, setToken } from './services/api';

const token = ref(getToken());

function saveToken(): void {
  setToken(token.value);
}
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: radial-gradient(circle at 20% 0%, #1f2937, #0b1220 45%);
  color: #e5e7eb;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
}

.topbar {
  display: grid;
  grid-template-columns: 220px auto 320px;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid #263244;
  background: rgba(17, 24, 39, 0.95);
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  font-weight: 700;
}

nav {
  display: flex;
  gap: 12px;
}

nav a {
  color: #93c5fd;
  text-decoration: none;
  padding: 8px 10px;
  border-radius: 8px;
}

nav a.router-link-active {
  background: #1e293b;
  color: #bfdbfe;
}

.token-wrap input {
  width: 100%;
  background: #0b1220;
  color: #e5e7eb;
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 8px 10px;
}

.page-wrap {
  max-width: 1100px;
  margin: 0 auto;
  padding: 18px;
}

@media (max-width: 900px) {
  .topbar {
    grid-template-columns: 1fr;
  }
}
</style>
