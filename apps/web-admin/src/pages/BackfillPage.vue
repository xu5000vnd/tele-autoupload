<template>
  <section class="stack">
    <div class="card top-row">
      <div>
        <h2>Media Backfill</h2>
        <div class="muted">Scan existing Telegram history and queue missing media for imported users.</div>
      </div>
    </div>

    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
    <p v-if="successMsg" class="ok">{{ successMsg }}</p>

    <section class="card">
      <form class="backfill-form" @submit.prevent="previewBackfill">
        <div class="form-grid">
          <label>
            <span>Telegram Chat ID</span>
            <input v-model="form.chat_id" type="text" required placeholder="-1001234567890" />
          </label>

          <label>
            <span>Scope</span>
            <input type="text" value="All active users in this group" disabled />
          </label>
        </div>

        <div class="form-grid">
          <label>
            <span>From Date</span>
            <input v-model="form.from_date" type="date" required />
          </label>

          <label>
            <span>To Date</span>
            <input v-model="form.to_date" type="date" required />
          </label>
        </div>

        <div class="form-actions">
          <button class="btn-secondary" type="submit" :disabled="submitting">
            {{ submitting && activeAction === 'preview' ? 'Previewing...' : 'Preview' }}
          </button>
          <button type="button" :disabled="submitting" @click="runBackfill">
            {{ submitting && activeAction === 'run' ? 'Running...' : 'Run Backfill' }}
          </button>
        </div>
      </form>
    </section>

    <section v-if="result" class="card result-card">
      <div class="result-heading">
        <div>
          <h3>{{ result.dry_run ? 'Preview Result' : 'Backfill Result' }}</h3>
          <div class="muted">
            {{ formatDate(result.from_date) }} to {{ formatDate(result.to_date) }} · chat {{ result.chat_id }}
          </div>
        </div>
        <span :class="['status', result.dry_run ? 'preview' : 'run']">
          {{ result.dry_run ? 'preview' : 'run' }}
        </span>
      </div>

      <div class="metrics-grid">
        <div>
          <span class="metric-value">{{ result.selected_users.length }}</span>
          <span class="metric-label">Selected users</span>
        </div>
        <div>
          <span class="metric-value">{{ result.scanned_messages }}</span>
          <span class="metric-label">Scanned messages</span>
        </div>
        <div>
          <span class="metric-value">{{ result.matched_messages }}</span>
          <span class="metric-label">Matched messages</span>
        </div>
        <div>
          <span class="metric-value">{{ result.media_found }}</span>
          <span class="metric-label">Media found</span>
        </div>
        <div>
          <span class="metric-value">{{ result.queued_media }}</span>
          <span class="metric-label">Queued media</span>
        </div>
        <div>
          <span class="metric-value">{{ result.skipped_existing }}</span>
          <span class="metric-label">Existing media</span>
        </div>
      </div>

      <div class="result-sections">
        <section>
          <h4>Selected Users</h4>
          <div v-if="result.selected_users.length" class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Telegram</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in result.selected_users" :key="user.id">
                  <td data-label="User">
                    <strong>{{ user.tu_name }}</strong>
                    <div class="muted">{{ user.tu_id }}</div>
                  </td>
                  <td data-label="Telegram">
                    <div>{{ user.telegram_user_id }}</div>
                    <div class="muted">{{ user.telegram_username ? `@${user.telegram_username}` : 'no_username' }}</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="muted">No selected users returned.</p>
        </section>

        <section>
          <h4>Unknown Senders</h4>
          <div v-if="result.unknown_senders.length" class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Messages</th>
                  <th>Media</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sender in result.unknown_senders" :key="`${sender.sender_id}:${sender.sender_username}`">
                  <td data-label="Sender">
                    <strong>{{ sender.sender_id || 'unknown' }}</strong>
                    <div class="muted">{{ sender.sender_username ? `@${sender.sender_username}` : 'no_username' }}</div>
                  </td>
                  <td data-label="Messages">{{ sender.message_count }}</td>
                  <td data-label="Media">{{ sender.media_count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="muted">No unknown senders in this scan.</p>
        </section>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { backfillMedia, type MediaBackfillResult } from '../services/api';

type Action = 'preview' | 'run';

const today = new Date().toISOString().slice(0, 10);

const form = reactive({
  chat_id: '',
  from_date: today,
  to_date: today,
});

const submitting = ref(false);
const activeAction = ref<Action | null>(null);
const result = ref<MediaBackfillResult | null>(null);
const errorMsg = ref('');
const successMsg = ref('');

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

async function submitBackfill(dryRun: boolean): Promise<void> {
  submitting.value = true;
  activeAction.value = dryRun ? 'preview' : 'run';
  errorMsg.value = '';
  successMsg.value = '';

  try {
    result.value = await backfillMedia({
      chat_id: form.chat_id.trim(),
      from_date: form.from_date,
      to_date: form.to_date,
      dry_run: dryRun,
    });
    successMsg.value = dryRun
      ? 'Preview completed. No media was queued.'
      : `Backfill completed. Queued ${result.value.queued_media} media item(s).`;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
    activeAction.value = null;
  }
}

function previewBackfill(): Promise<void> {
  return submitBackfill(true);
}

function runBackfill(): Promise<void> {
  return submitBackfill(false);
}
</script>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.card {
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid #263244;
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.24);
}

.top-row,
.result-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

h2,
h3,
h4 {
  margin: 0;
  color: #f8fafc;
}

h2 {
  font-size: 28px;
}

h3 {
  font-size: 22px;
}

h4 {
  margin-bottom: 10px;
  font-size: 16px;
}

.muted {
  color: #94a3b8;
}

.err,
.ok {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
}

.err {
  border: 1px solid #7f1d1d;
  background: #450a0a;
  color: #fecaca;
}

.ok {
  border: 1px solid #14532d;
  background: #052e16;
  color: #bbf7d0;
}

.backfill-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #cbd5e1;
  font-weight: 650;
}

input,
select,
textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #263244;
  border-radius: 10px;
  padding: 12px 14px;
  background: #0b1220;
  color: #f8fafc;
  font: inherit;
}

textarea {
  min-height: 150px;
  resize: vertical;
}

input:disabled,
textarea:disabled {
  color: #64748b;
  cursor: not-allowed;
}

button {
  border: 0;
  border-radius: 10px;
  padding: 12px 18px;
  background: #2563eb;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: #1e293b;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.status {
  display: inline-flex;
  border-radius: 999px;
  padding: 6px 10px;
  background: #1e293b;
  color: #bfdbfe;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}

.status.run {
  background: #14532d;
  color: #bbf7d0;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.metrics-grid > div {
  border: 1px solid #263244;
  border-radius: 10px;
  padding: 14px;
  background: #0b1220;
}

.metric-value,
.metric-label {
  display: block;
}

.metric-value {
  color: #f8fafc;
  font-size: 26px;
  font-weight: 800;
}

.metric-label {
  margin-top: 4px;
  color: #94a3b8;
}

.result-sections {
  display: grid;
  gap: 18px;
  margin-top: 22px;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid #263244;
  border-radius: 10px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 12px 14px;
  border-bottom: 1px solid #263244;
  text-align: left;
  vertical-align: top;
}

th {
  color: #93c5fd;
}

tr:last-child td {
  border-bottom: 0;
}

@media (max-width: 900px) {
  .form-grid,
  .metrics-grid {
    grid-template-columns: 1fr;
  }

  .top-row,
  .result-heading,
  .form-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .form-actions button {
    width: 100%;
  }
}
</style>
