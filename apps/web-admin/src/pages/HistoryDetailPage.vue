<template>
  <section class="stack">
    <div class="card top-row">
      <div>
        <h2>Campaign Detail</h2>
        <div class="muted" v-if="detail">{{ detail.campaign_id }} · {{ detail.status }}</div>
      </div>
      <div class="actions">
        <RouterLink class="back-link" to="/histories">Back to Histories</RouterLink>
        <button :disabled="loading" type="button" @click="loadDetail">
          {{ loading ? 'Loading...' : 'Reload' }}
        </button>
      </div>
    </div>

    <p class="err" v-if="errorMsg">{{ errorMsg }}</p>
    <div v-if="loading && !detail" class="card muted">Loading campaign detail...</div>

    <template v-if="detail">
      <div class="summary-grid">
        <div class="card summary-card">
          <div class="summary-label">Status</div>
          <div :class="['summary-value', 'status-text', detail.status]">{{ detail.status }}</div>
        </div>
        <div class="card summary-card">
          <div class="summary-label">Targets</div>
          <div class="summary-value">{{ detail.total_targets }}</div>
          <div class="muted">Sent {{ detail.success_targets }} · Failed {{ detail.failed_targets }}</div>
        </div>
        <div class="card summary-card">
          <div class="summary-label">Media</div>
          <div class="summary-value">{{ detail.medias.length }}</div>
        </div>
        <div class="card summary-card">
          <div class="summary-label">Created</div>
          <div>{{ formatDate(detail.created_at) }}</div>
          <div class="muted">{{ detail.created_by }}</div>
        </div>
      </div>

      <div class="card">
        <h3>Message</h3>
        <pre>{{ detail.body_template || 'No message body.' }}</pre>
      </div>

      <div class="card" v-if="detail.medias.length">
        <h3>Media</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>File</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="media in detail.medias" :key="media.id">
                <td>{{ media.order_index + 1 }}</td>
                <td class="text-ellipsis">{{ media.file_name }}</td>
                <td>{{ media.mime_type || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>Targets</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Chat</th>
                <th>Status</th>
                <th>Attempt</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="target in detail.targets" :key="target.id">
                <td>
                  <RouterLink v-if="target.user_tu_id" class="user-link" :to="`/users/${target.user_tu_id}`">
                    {{ target.tu_name }}
                  </RouterLink>
                  <span v-else>{{ target.tu_name }}</span>
                </td>
                <td>{{ target.telegram_chat_id }}</td>
                <td><span :class="['status', target.status]">{{ target.status }}</span></td>
                <td>{{ target.attempt_count }}</td>
                <td class="muted text-ellipsis">{{ target.error || '-' }}</td>
              </tr>
              <tr v-if="!detail.targets.length">
                <td colspan="5" class="muted">No campaign targets found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { getHistoryDetail, type HistoryDetailResponse } from '../services/api';

const route = useRoute();
const detail = ref<HistoryDetailResponse | null>(null);
const loading = ref(false);
const errorMsg = ref('');

const campaignId = computed(() => String(route.params.campaignId ?? ''));

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

async function loadDetail(): Promise<void> {
  if (!campaignId.value) {
    errorMsg.value = 'Missing campaign id.';
    return;
  }

  loading.value = true;
  errorMsg.value = '';
  try {
    detail.value = await getHistoryDetail(campaignId.value);
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => route.params.campaignId,
  () => {
    detail.value = null;
    void loadDetail();
  },
);

onMounted(() => {
  void loadDetail();
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
.actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

h2,
h3 {
  margin: 0;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.summary-card {
  display: grid;
  gap: 8px;
}

.summary-label {
  color: #94a3b8;
  font-size: 12px;
}

.summary-value {
  font-size: 28px;
  font-weight: 700;
}

.table-wrap {
  overflow: auto;
  margin-top: 8px;
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

pre {
  white-space: pre-wrap;
  background: #0b1220;
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 10px;
  margin: 10px 0 0;
}

button,
.back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  padding: 9px 12px;
  background: #2563eb;
  color: #fff;
  text-decoration: none;
  cursor: pointer;
}

.back-link {
  background: #1e293b;
}

button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.user-link {
  color: #bfdbfe;
  text-decoration: none;
}

.user-link:hover {
  color: #dbeafe;
  text-decoration: underline;
}

.status,
.status-text {
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.status {
  font-size: 12px;
}

.status.completed,
.status.sent,
.status-text.completed {
  color: #4ade80;
}

.status.partial_failed,
.status-text.partial_failed {
  color: #facc15;
}

.status.failed,
.status-text.failed {
  color: #f87171;
}

.status.running,
.status.pending,
.status.queued,
.status.sending,
.status-text.running,
.status-text.pending,
.status-text.queued,
.status-text.sending {
  color: #93c5fd;
}

.muted {
  color: #94a3b8;
}

.err {
  color: #f87171;
  white-space: pre-wrap;
}

.text-ellipsis {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 760px) {
  .top-row,
  .actions {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
