<template>
  <section class="stack">
    <div class="card top-row">
      <div>
        <h2>Dashboard</h2>
        <div class="muted" v-if="overview">Updated: {{ formatDate(overview.generated_at) }}</div>
      </div>
      <button :disabled="loading" @click="loadOverview">{{ loading ? 'Loading...' : 'Reload' }}</button>
    </div>

    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>

    <template v-if="overview">
      <div class="metrics-grid">
        <div class="card metric">
          <div class="metric-label">System Status</div>
          <div :class="['metric-value', overview.health.status]">{{ overview.health.status }}</div>
        </div>
        <div class="card metric">
          <div class="metric-label">Queue Waiting</div>
          <div class="metric-value">{{ overview.health.queues.upload.waiting ?? 0 }}</div>
        </div>
        <div class="card metric">
          <div class="metric-label">Today Received</div>
          <div class="metric-value">{{ overview.today_summary.total_received }}</div>
        </div>
        <div class="card metric">
          <div class="metric-label">Today Uploaded</div>
          <div class="metric-value ok">{{ overview.today_summary.total_uploaded }}</div>
        </div>
        <div class="card metric">
          <div class="metric-label">Today Failed</div>
          <div class="metric-value err-text">{{ overview.today_summary.total_failed }}</div>
        </div>
        <div class="card metric">
          <div class="metric-label">Storage Used</div>
          <div class="metric-value">{{ overview.health.staging.used_pct }}%</div>
          <div class="muted">{{ overview.health.staging.used_gb }} / {{ overview.health.staging.cap_gb }} GB</div>
        </div>
      </div>

      <div class="two-col">
        <div class="card">
          <h3>Top Uploaders Today</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Chat</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in overview.today_summary.top_uploaders" :key="`${u.chat_id}_${u.sender_id}`">
                  <td>
                    <b>{{ u.tu_name }}</b>
                    <div class="muted">{{ u.telegram_username ? `@${u.telegram_username}` : 'no_username' }}</div>
                  </td>
                  <td>{{ u.chat_id }}</td>
                  <td>{{ u.total }}</td>
                </tr>
                <tr v-if="!overview.today_summary.top_uploaders.length">
                  <td colspan="3" class="muted">No uploads yet today.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3>Top Failure Reasons</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Error</th>
                  <th>Count</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in overview.recent_failures" :key="`${f.error}-${f.last_at}`">
                  <td class="text-ellipsis">{{ f.error || 'Unknown error' }}</td>
                  <td>{{ f.count }}</td>
                  <td>{{ f.last_at ? formatDate(f.last_at) : '-' }}</td>
                </tr>
                <tr v-if="!overview.recent_failures.length">
                  <td colspan="3" class="muted">No failure records.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-row">
          <h3>Broadcast Campaigns</h3>
          <RouterLink to="/histories">Open Histories</RouterLink>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Targets</th>
                <th>Media</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in overview.campaigns" :key="c.campaign_id">
                <td><code>{{ c.campaign_id }}</code></td>
                <td><span :class="['status', c.status]">{{ c.status }}</span></td>
                <td>✅ {{ c.success_targets }} / ❌ {{ c.failed_targets }} / 📦 {{ c.total_targets }}</td>
                <td>{{ c.media_count }}</td>
                <td>{{ formatDate(c.created_at) }}</td>
              </tr>
              <tr v-if="!overview.campaigns.length">
                <td colspan="5" class="muted">No campaign data.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>Recent Activity</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Sender</th>
                <th>Type</th>
                <th>Status</th>
                <th>File</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in overview.recent_activity" :key="a.id">
                <td>{{ formatDate(a.created_at) }}</td>
                <td>
                  <div>{{ a.sender_id || 'unknown' }}</div>
                  <div class="muted">chat {{ a.chat_id }}</div>
                </td>
                <td>{{ a.media_type }}</td>
                <td><span :class="['status', a.status]">{{ a.status }}</span></td>
                <td class="text-ellipsis">{{ a.file_name || '-' }}</td>
                <td class="text-ellipsis">{{ a.error || '-' }}</td>
              </tr>
              <tr v-if="!overview.recent_activity.length">
                <td colspan="6" class="muted">No activity.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { apiGet, type DashboardOverview } from '../services/api';

const overview = ref<DashboardOverview | null>(null);
const loading = ref(false);
const errorMsg = ref('');

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

async function loadOverview(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  try {
    overview.value = await apiGet<DashboardOverview>('/api/dashboard/overview');
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadOverview();
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
.section-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

h2,
h3 {
  margin: 0;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.metric-label {
  color: #94a3b8;
  font-size: 12px;
  margin-bottom: 6px;
}

.metric-value {
  font-size: 26px;
  font-weight: 700;
}

.metric-value.healthy,
.ok {
  color: #4ade80;
}

.metric-value.degraded,
.err-text {
  color: #f87171;
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
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

.status {
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: 0.03em;
}

.status.completed,
.status.sent,
.status.uploaded {
  color: #4ade80;
}

.status.partial_failed,
.status.queued,
.status.uploading,
.status.downloaded,
.status.downloading,
.status.running,
.status.pending {
  color: #93c5fd;
}

.status.failed {
  color: #f87171;
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

.muted {
  color: #94a3b8;
}

.err {
  color: #f87171;
  white-space: pre-wrap;
}

.text-ellipsis {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
