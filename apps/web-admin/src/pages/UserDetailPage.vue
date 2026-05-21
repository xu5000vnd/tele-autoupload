<template>
  <section class="stack">
    <div class="card top-row">
      <div>
        <h2>User Detail</h2>
        <div v-if="detail" class="muted">{{ detail.user.tu_name }} · {{ detail.timezone }}</div>
        <div v-else class="muted">Upload history by date.</div>
      </div>
      <div class="actions">
        <RouterLink class="back-link" to="/users">Back to Users</RouterLink>
        <button class="btn-secondary" :disabled="loading" type="button" @click="loadDetail">
          {{ loading ? 'Loading...' : 'Reload' }}
        </button>
      </div>
    </div>

    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
    <div v-if="loading && !detail" class="card muted">Loading user detail...</div>

    <template v-if="detail">
      <div class="summary-grid">
        <section class="card summary-card">
          <span class="summary-label">Total Media</span>
          <strong>{{ detail.summary.total_media }}</strong>
        </section>
        <section class="card summary-card">
          <span class="summary-label">Uploaded</span>
          <strong class="ok">{{ detail.summary.uploaded_count }}</strong>
        </section>
        <section class="card summary-card">
          <span class="summary-label">Failed</span>
          <strong class="err">{{ detail.summary.failed_count }}</strong>
        </section>
        <section class="card summary-card">
          <span class="summary-label">Pending</span>
          <strong>{{ detail.summary.pending_count }}</strong>
        </section>
      </div>

      <section class="card user-card">
        <div>
          <span class="detail-label">TU ID</span>
          <strong>{{ detail.user.tu_id }}</strong>
        </div>
        <div>
          <span class="detail-label">Telegram Username</span>
          <strong>{{ detail.user.telegram_username ? `@${detail.user.telegram_username}` : 'no_username' }}</strong>
        </div>
        <div>
          <span class="detail-label">Chat ID</span>
          <strong>{{ detail.user.telegram_chat_id }}</strong>
        </div>
        <div>
          <span class="detail-label">User ID</span>
          <strong>{{ detail.user.telegram_user_id }}</strong>
        </div>
        <div class="wide">
          <span class="detail-label">Path</span>
          <strong>{{ detail.user.path || 'no path' }}</strong>
        </div>
      </section>

      <section class="card">
        <div class="section-heading">
          <div>
            <h3>Upload History</h3>
            <div class="muted">{{ detail.total_dates }} date(s) with uploaded media records</div>
          </div>
        </div>

        <div v-if="detail.items.length" class="history-list">
          <article v-for="item in detail.items" :key="item.date" class="history-row">
            <div class="history-main">
              <strong>{{ formatDate(item.date) }}</strong>
              <span class="muted">{{ item.total_media }} total</span>
            </div>
            <div class="history-counts">
              <span>Images {{ item.image_count }}</span>
              <span>Videos {{ item.video_count }}</span>
              <span>Docs {{ item.document_count }}</span>
            </div>
            <div class="history-statuses">
              <span class="ok">{{ item.uploaded_count }} uploaded</span>
              <span class="err">{{ item.failed_count }} failed</span>
              <span class="muted">{{ item.pending_count }} pending</span>
            </div>
          </article>
        </div>
        <div v-else class="muted empty-state">No upload history found.</div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { getTargetUploadHistory, type TargetUploadHistoryResponse } from '../services/api';

const route = useRoute();
const detail = ref<TargetUploadHistoryResponse | null>(null);
const loading = ref(false);
const errorMsg = ref('');

const userId = computed(() => Number(route.params.id));

async function loadDetail(): Promise<void> {
  if (!Number.isInteger(userId.value) || userId.value <= 0) {
    errorMsg.value = 'Invalid user id.';
    return;
  }

  loading.value = true;
  errorMsg.value = '';

  try {
    detail.value = await getTargetUploadHistory(userId.value);
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

watch(
  () => route.params.id,
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
.actions,
.section-heading {
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

.back-link {
  color: #93c5fd;
  text-decoration: none;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.summary-card {
  display: grid;
  gap: 8px;
}

.summary-card strong {
  font-size: 28px;
}

.summary-label,
.detail-label {
  color: #94a3b8;
  font-size: 12px;
}

.user-card {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.user-card > div {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid #263244;
  border-radius: 8px;
  background: #0b1220;
}

.user-card strong {
  overflow-wrap: anywhere;
}

.wide {
  grid-column: 1 / -1;
}

.history-list {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.history-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(0, 1.2fr) minmax(0, 1.4fr);
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid #263244;
  border-radius: 8px;
  background: #0b1220;
}

.history-main,
.history-counts,
.history-statuses {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.history-main {
  flex-direction: column;
  gap: 4px;
}

.history-counts span,
.history-statuses span {
  border-radius: 999px;
  background: #172033;
  padding: 5px 8px;
  font-size: 12px;
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

.muted {
  color: #94a3b8;
}

.ok {
  color: #4ade80;
}

.err {
  color: #f87171;
  white-space: pre-wrap;
}

.empty-state {
  padding-top: 12px;
}

@media (max-width: 820px) {
  .history-row {
    grid-template-columns: 1fr;
  }
}
</style>
