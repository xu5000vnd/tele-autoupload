<template>
  <section class="stack">
    <div class="card top-row">
      <div>
        <h2>Users</h2>
        <div class="muted">Manage TU users used by upload tracking and broadcast targets.</div>
      </div>
      <div class="actions">
        <button class="btn-secondary" :disabled="loading" type="button" @click="loadUsers">
          {{ loading ? 'Loading...' : 'Reload' }}
        </button>
        <button type="button" @click="startCreate">New User</button>
      </div>
    </div>

    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
    <p v-if="successMsg" class="ok">{{ successMsg }}</p>

    <div class="layout">
      <section class="card">
        <div class="filters">
          <label>
            <span>Search</span>
            <input
              v-model="search"
              type="text"
              placeholder="Search name / tu_id / username / chat"
              @input="applyLocalFilter"
            />
          </label>
          <label class="status-filter">
            <span>Status</span>
            <select v-model="statusFilter" @change="loadUsers">
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Telegram</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="user in filteredUsers"
                :key="user.id"
                :class="{ selected: user.id === editingId }"
              >
                <td>
                  <strong>{{ user.tu_name }}</strong>
                  <div class="muted">{{ user.tu_id }}</div>
                  <div class="muted path-text">{{ user.path || 'no path' }}</div>
                </td>
                <td>
                  <div>{{ user.telegram_chat_id }}</div>
                  <div class="muted">
                    {{ user.telegram_username ? `@${user.telegram_username}` : 'no_username' }}
                  </div>
                  <div class="muted">{{ user.telegram_user_id }}</div>
                </td>
                <td>
                  <span :class="['status', user.status ?? 'active']">{{ user.status ?? 'active' }}</span>
                </td>
                <td class="action-cell">
                  <button class="btn-secondary" type="button" @click="editUser(user)">Edit</button>
                </td>
              </tr>
              <tr v-if="!filteredUsers.length">
                <td colspan="4" class="muted">No users found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card form-card">
        <div class="form-heading">
          <h3>{{ editingId ? 'Update User' : 'Add User' }}</h3>
          <button v-if="editingId" class="btn-secondary" type="button" @click="startCreate">Cancel</button>
        </div>

        <form class="user-form" @submit.prevent="saveUser">
          <label>
            <span>TU ID</span>
            <input v-model="form.tu_id" type="text" required />
          </label>

          <label>
            <span>TU Name</span>
            <input v-model="form.tu_name" type="text" required />
          </label>

          <label>
            <span>Telegram Chat ID</span>
            <input v-model="form.telegram_chat_id" type="text" required />
          </label>

          <label>
            <span>Telegram User ID</span>
            <input v-model="form.telegram_user_id" type="text" required />
          </label>

          <label>
            <span>Telegram Username</span>
            <input v-model="form.telegram_username" type="text" placeholder="@username" />
          </label>

          <label>
            <span>Path</span>
            <input v-model="form.path" type="text" placeholder="TU Media General/[tu_id] Name" />
          </label>

          <label>
            <span>Status</span>
            <select v-model="form.status">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>

          <button :disabled="saving" type="submit">
            {{ saving ? 'Saving...' : editingId ? 'Update User' : 'Add User' }}
          </button>
        </form>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import {
  addTarget,
  listTargets,
  updateTarget,
  type SaveTargetRequest,
  type Target,
} from '../services/api';

type StatusFilter = 'active' | 'inactive' | 'all';

const users = ref<Target[]>([]);
const filteredUsers = ref<Target[]>([]);
const loading = ref(false);
const saving = ref(false);
const search = ref('');
const statusFilter = ref<StatusFilter>('all');
const editingId = ref<number | null>(null);
const errorMsg = ref('');
const successMsg = ref('');

const form = reactive({
  tu_id: '',
  tu_name: '',
  telegram_chat_id: '',
  telegram_user_id: '',
  telegram_username: '',
  path: '',
  status: 'active' as 'active' | 'inactive',
});

function applyLocalFilter(): void {
  const q = search.value.trim().toLowerCase();
  if (!q) {
    filteredUsers.value = [...users.value];
    return;
  }

  filteredUsers.value = users.value.filter((user) => {
    return (
      user.tu_name.toLowerCase().includes(q) ||
      user.tu_id.toLowerCase().includes(q) ||
      user.telegram_chat_id.includes(q) ||
      user.telegram_user_id.includes(q) ||
      (user.telegram_username ?? '').toLowerCase().includes(q) ||
      (user.path ?? '').toLowerCase().includes(q)
    );
  });
}

async function loadUsers(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  try {
    users.value = await listTargets(search.value, statusFilter.value);
    applyLocalFilter();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function startCreate(): void {
  editingId.value = null;
  form.tu_id = '';
  form.tu_name = '';
  form.telegram_chat_id = '';
  form.telegram_user_id = '';
  form.telegram_username = '';
  form.path = '';
  form.status = 'active';
  successMsg.value = '';
  errorMsg.value = '';
}

function editUser(user: Target): void {
  editingId.value = user.id;
  form.tu_id = user.tu_id;
  form.tu_name = user.tu_name;
  form.telegram_chat_id = user.telegram_chat_id;
  form.telegram_user_id = user.telegram_user_id;
  form.telegram_username = user.telegram_username ?? '';
  form.path = user.path ?? '';
  form.status = user.status ?? 'active';
  successMsg.value = '';
  errorMsg.value = '';
}

function buildPayload(): SaveTargetRequest {
  return {
    tu_id: form.tu_id.trim(),
    tu_name: form.tu_name.trim(),
    telegram_chat_id: form.telegram_chat_id.trim(),
    telegram_user_id: form.telegram_user_id.trim(),
    telegram_username: form.telegram_username.trim() || null,
    path: form.path.trim() || null,
    status: form.status,
  };
}

async function saveUser(): Promise<void> {
  saving.value = true;
  errorMsg.value = '';
  successMsg.value = '';

  try {
    const payload = buildPayload();
    const saved = editingId.value
      ? await updateTarget(editingId.value, payload)
      : await addTarget(payload);

    successMsg.value = `${saved.tu_name} ${editingId.value ? 'updated' : 'added'}.`;
    await loadUsers();
    editUser(saved);
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadUsers();
});
</script>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  background: rgba(17, 24, 39, 0.92);
  border: 1px solid #263244;
  border-radius: 14px;
  padding: 16px;
}

.top-row,
.form-heading,
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

h2,
h3 {
  margin: 0;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
  gap: 12px;
  align-items: start;
}

.filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px;
  gap: 10px;
  margin-bottom: 10px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #cbd5e1;
}

input,
select {
  width: 100%;
  background: #0b1220;
  color: #e5e7eb;
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 10px;
}

.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  text-align: left;
  padding: 10px;
  border-bottom: 1px solid #263244;
  vertical-align: top;
}

th {
  color: #93c5fd;
}

tr.selected {
  background: rgba(37, 99, 235, 0.12);
}

.path-text {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-cell {
  text-align: right;
}

.user-form {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

button {
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 9px 12px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.btn-secondary {
  background: #1e293b;
}

.status {
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: 0.03em;
}

.status.active,
.ok {
  color: #4ade80;
}

.status.inactive,
.err {
  color: #f87171;
}

.muted {
  color: #94a3b8;
}

.err {
  white-space: pre-wrap;
}

@media (max-width: 980px) {
  .layout,
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
