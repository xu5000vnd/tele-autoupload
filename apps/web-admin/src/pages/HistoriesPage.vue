<template>
  <section class="card">
    <div class="top-row">
      <h2>Histories</h2>
      <button :disabled="loading" @click="loadHistories">{{ loading ? 'Loading...' : 'Reload' }}</button>
    </div>

    <p class="err" v-if="errorMsg">{{ errorMsg }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Status</th>
            <th>Targets</th>
            <th>Media</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.campaign_id">
            <td>
              <code>{{ item.campaign_id }}</code>
              <div class="muted text-ellipsis">{{ item.body_template }}</div>
            </td>
            <td><span :class="['status', item.status]">{{ item.status }}</span></td>
            <td>✅ {{ item.success_targets }} / ❌ {{ item.failed_targets }} / 📦 {{ item.total_targets }}</td>
            <td>{{ item.media_count }}</td>
            <td>{{ formatDate(item.created_at) }}</td>
            <td>
              <RouterLink class="btn-link" :to="`/histories/${encodeURIComponent(item.campaign_id)}`">
                Detail
              </RouterLink>
            </td>
          </tr>
          <tr v-if="!items.length">
            <td colspan="6" class="muted">No history found.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { apiGet, type HistoryItem } from '../services/api';

type HistoryListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: HistoryItem[];
};

const items = ref<HistoryItem[]>([]);
const loading = ref(false);
const errorMsg = ref('');

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

async function loadHistories(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  try {
    const data = await apiGet<HistoryListResponse>('/api/messages/histories?limit=50&offset=0');
    items.value = data.items ?? [];
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadHistories();
});
</script>

<style scoped>
.card {
  background: rgba(17, 24, 39, 0.92);
  border: 1px solid #263244;
  border-radius: 14px;
  padding: 16px;
}

.top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

h2 { margin-top: 0; }

.btn-link,
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 9px 12px;
  cursor: pointer;
  text-decoration: none;
}

button:disabled { opacity: 0.65; cursor: not-allowed; }

.table-wrap {
  overflow: auto;
  margin-top: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  text-align: left;
  padding: 10px;
  border-bottom: 1px solid #263244;
  vertical-align: top;
}

th { color: #93c5fd; }

.status {
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: 0.03em;
}

.status.completed, .status.sent { color: #4ade80; }
.status.partial_failed { color: #facc15; }
.status.failed { color: #f87171; }
.status.running, .status.pending, .status.queued, .status.sending { color: #93c5fd; }

.muted { color: #94a3b8; }
.err { color: #f87171; white-space: pre-wrap; }
.text-ellipsis {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
