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
        <RouterLink
          v-if="detail"
          class="btn-link"
          :to="{ path: '/backfill', query: { chat_id: detail.user.telegram_chat_id } }"
        >
          Backfill
        </RouterLink>
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
            <div class="history-action">
              <button type="button" @click="openBackfillModal(item)">Backfill</button>
            </div>
          </article>
        </div>
        <div v-else class="muted empty-state">No upload history found.</div>
      </section>
    </template>

    <Teleport to="body">
      <div v-if="backfillOpen" class="modal-backdrop" @click.self="closeBackfillModal">
        <section class="modal-card">
          <div class="modal-heading">
            <div>
              <h3>Backfill Media</h3>
              <div class="muted">Scan Telegram history for this group and date.</div>
            </div>
            <button class="btn-secondary icon-button" type="button" aria-label="Close" @click="closeBackfillModal">
              x
            </button>
          </div>

          <p v-if="backfillError" class="err modal-message">{{ backfillError }}</p>
          <p v-if="backfillSuccess" class="ok modal-message">{{ backfillSuccess }}</p>

          <div class="backfill-fields">
            <label>
              <span>Telegram Chat ID</span>
              <input v-model="backfillForm.chat_id" type="text" disabled />
            </label>

            <label>
              <span>Date</span>
              <input v-model="backfillForm.date" type="date" disabled />
            </label>

            <label class="wide">
              <span>Scope</span>
              <input type="text" value="All active users in this group" disabled />
            </label>
          </div>

          <div v-if="backfillResult" class="backfill-result">
            <div>
              <strong>{{ backfillResult.selected_users.length }}</strong>
              <span>selected users</span>
            </div>
            <div>
              <strong>{{ backfillResult.scanned_messages }}</strong>
              <span>scanned</span>
            </div>
            <div>
              <strong>{{ backfillResult.media_found }}</strong>
              <span>media found</span>
            </div>
            <div>
              <strong>{{ backfillResult.queued_media }}</strong>
              <span>queued</span>
            </div>
            <div>
              <strong>{{ backfillResult.retried_failed }}</strong>
              <span>retried failed</span>
            </div>
            <div>
              <strong>{{ backfillResult.skipped_existing }}</strong>
              <span>existing</span>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn-secondary" type="button" @click="closeBackfillModal">Cancel</button>
            <button class="btn-secondary" :disabled="backfillSubmitting" type="button" @click="submitBackfill(true)">
              {{ backfillSubmitting && backfillAction === 'preview' ? 'Previewing...' : 'Preview' }}
            </button>
            <button :disabled="backfillSubmitting" type="button" @click="submitBackfill(false)">
              {{ backfillSubmitting && backfillAction === 'run' ? 'Running...' : 'Run Backfill' }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import {
  backfillMedia,
  getTargetUploadHistory,
  type MediaBackfillResult,
  type TargetUploadHistoryDay,
  type TargetUploadHistoryResponse,
} from '../services/api';

type BackfillAction = 'preview' | 'run';

const route = useRoute();
const detail = ref<TargetUploadHistoryResponse | null>(null);
const loading = ref(false);
const errorMsg = ref('');
const backfillOpen = ref(false);
const backfillSubmitting = ref(false);
const backfillAction = ref<BackfillAction | null>(null);
const backfillResult = ref<MediaBackfillResult | null>(null);
const backfillError = ref('');
const backfillSuccess = ref('');
const backfillForm = reactive({
  chat_id: '',
  date: '',
});

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

function openBackfillModal(item: TargetUploadHistoryDay): void {
  if (!detail.value) {
    return;
  }

  backfillForm.chat_id = detail.value.user.telegram_chat_id;
  backfillForm.date = item.date;
  backfillResult.value = null;
  backfillError.value = '';
  backfillSuccess.value = '';
  backfillOpen.value = true;
}

function closeBackfillModal(): void {
  if (backfillSubmitting.value) {
    return;
  }

  backfillOpen.value = false;
}

async function submitBackfill(dryRun: boolean): Promise<void> {
  backfillSubmitting.value = true;
  backfillAction.value = dryRun ? 'preview' : 'run';
  backfillError.value = '';
  backfillSuccess.value = '';

  try {
    backfillResult.value = await backfillMedia({
      chat_id: backfillForm.chat_id,
      from_date: backfillForm.date,
      to_date: backfillForm.date,
      dry_run: dryRun,
    });
    backfillSuccess.value = dryRun
      ? 'Preview completed. No media was queued or retried.'
      : `Backfill completed. Queued ${backfillResult.value.queued_media} new and retried ${backfillResult.value.retried_failed} failed media item(s).`;
  } catch (err) {
    backfillError.value = err instanceof Error ? err.message : String(err);
  } finally {
    backfillSubmitting.value = false;
    backfillAction.value = null;
  }
}

watch(
  () => route.params.id,
  () => {
    detail.value = null;
    backfillOpen.value = false;
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

.btn-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  text-decoration: none;
  background: #2563eb;
  border-radius: 8px;
  padding: 9px 12px;
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
  grid-template-columns: minmax(180px, 1fr) minmax(0, 1.2fr) minmax(0, 1.4fr) auto;
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

.history-action {
  display: flex;
  justify-content: flex-end;
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

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(3, 7, 18, 0.72);
}

.modal-card {
  width: min(720px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: #111827;
  border: 1px solid #334155;
  border-radius: 14px;
  padding: 18px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  color: #e5e7eb;
}

.modal-card,
.modal-card * {
  box-sizing: border-box;
}

.modal-heading,
.modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.icon-button {
  width: 36px;
  height: 36px;
  padding: 0;
}

.modal-message {
  margin: 14px 0 0;
}

.backfill-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.backfill-fields label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #cbd5e1;
  font-size: 14px;
  font-weight: 700;
}

.backfill-fields input {
  width: 100%;
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 11px 12px;
  background: #0b1220;
  color: #e5e7eb;
  font: inherit;
}

.backfill-fields input:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}

.backfill-result {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.backfill-result > div {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid #263244;
  border-radius: 8px;
  background: #0b1220;
}

.backfill-result strong {
  font-size: 22px;
}

.backfill-result span {
  color: #94a3b8;
  font-size: 12px;
}

.modal-actions {
  justify-content: flex-end;
  margin-top: 16px;
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

  .history-action,
  .modal-actions {
    justify-content: stretch;
  }

  .history-action button,
  .modal-actions button {
    width: 100%;
  }

  .backfill-fields,
  .backfill-result {
    grid-template-columns: 1fr;
  }
}
</style>
