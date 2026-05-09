<template>
  <div v-if="authenticated" class="app-shell">
    <header class="topbar">
      <div class="brand">Tele Auto Upload Admin</div>
      <nav>
        <RouterLink to="/dashboard">Dashboard</RouterLink>
        <RouterLink to="/users">Users</RouterLink>
        <RouterLink to="/messages">Messages</RouterLink>
        <RouterLink to="/histories">Histories</RouterLink>
      </nav>
      <div class="user-wrap">
        <span class="muted user-name">{{ username }}</span>
        <button class="logout-btn" type="button" @click="logout">Logout</button>
      </div>
    </header>

    <main class="page-wrap">
      <RouterView />
    </main>
  </div>

  <div v-else class="login-shell">
    <section class="login-card">
      <div>
        <h1>Tele Auto Upload Admin</h1>
        <p class="muted">Sign in with your admin username and password.</p>
      </div>

      <p v-if="errorMsg" class="err">{{ errorMsg }}</p>

      <form class="login-form" @submit.prevent="login">
        <label>
          <span>Username</span>
          <input v-model="loginForm.username" type="text" autocomplete="username" />
        </label>

        <label>
          <span>Password</span>
          <input v-model="loginForm.password" type="password" autocomplete="current-password" />
        </label>

        <button :disabled="submitting" type="submit">
          {{ submitting ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import {
  apiPost,
  clearAuthSession,
  getAuthUsername,
  isAuthenticated,
  setAuthSession,
  type LoginResponse,
} from './services/api';

const router = useRouter();
const authenticated = ref(isAuthenticated());
const username = ref(getAuthUsername());
const submitting = ref(false);
const errorMsg = ref('');
const loginForm = reactive({
  username: '',
  password: '',
});

async function login(): Promise<void> {
  submitting.value = true;
  errorMsg.value = '';

  try {
    const result = await apiPost<LoginResponse>('/api/auth/login', {
      username: loginForm.username.trim(),
      password: loginForm.password,
    });

    setAuthSession({
      token: result.token,
      username: result.username,
    });
    username.value = result.username;
    authenticated.value = true;
    loginForm.password = '';
    void router.push('/dashboard');
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}

function logout(): void {
  clearAuthSession();
  authenticated.value = false;
  username.value = '';
  loginForm.username = '';
  loginForm.password = '';
  errorMsg.value = '';
  void router.push('/dashboard');
}
</script>

<style>
html,
body,
#app {
  margin: 0;
  min-height: 100%;
  background: #0b1220;
}
</style>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: radial-gradient(circle at 20% 0%, #1f2937, #0b1220 45%);
  color: #e5e7eb;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
}

.topbar {
  display: grid;
  grid-template-columns: 220px auto 220px;
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

.user-wrap {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.user-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.logout-btn {
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 8px 10px;
  background: #0b1220;
  color: #e5e7eb;
  cursor: pointer;
}

.page-wrap {
  max-width: 1100px;
  margin: 0 auto;
  padding: 18px;
}

.login-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: radial-gradient(circle at 20% 0%, #1f2937, #0b1220 45%);
  color: #e5e7eb;
}

.login-card {
  width: min(100%, 420px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: rgba(17, 24, 39, 0.94);
  border: 1px solid #263244;
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
}

.login-card h1 {
  margin: 0 0 8px;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.login-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login-form input {
  width: 100%;
  background: #0b1220;
  color: #e5e7eb;
  border: 1px solid #263244;
  border-radius: 10px;
  padding: 10px 12px;
}

.login-form button {
  border: none;
  border-radius: 10px;
  padding: 11px 14px;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
}

.login-form button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.muted {
  color: #94a3b8;
}

.err {
  color: #f87171;
  white-space: pre-wrap;
}

@media (max-width: 900px) {
  .topbar {
    grid-template-columns: 1fr;
  }

  .user-wrap {
    justify-content: flex-start;
  }
}
</style>
