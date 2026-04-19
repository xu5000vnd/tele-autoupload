<template>
  <section class="stack">
    <div class="card top-row">
      <div>
        <h2>Dashboard</h2>
        <div class="muted" v-if="overview">Updated: {{ formatDate(overview.generated_at) }}</div>
      </div>
      <button :disabled="loading" @click="loadDashboard">{{ loading ? 'Loading...' : 'Reload' }}</button>
    </div>

    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>

    <div v-if="loading && !overview" class="card muted">Loading dashboard data...</div>

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

      <div class="card">
        <div class="section-row">
          <div class="section-heading">
            <h3>Monthly Activity</h3>
            <div class="muted">Uploaded media by reporting cycle in {{ heatmap?.year ?? currentYear }}</div>
          </div>
          <div class="section-badges">
            <span class="pill">{{ formatCycleRule(heatmap?.cycle_close_day) }}</span>
            <span class="pill">{{ heatmap?.timezone ?? 'Asia/Ho_Chi_Minh' }}</span>
          </div>
        </div>

        <div class="heat-grid" v-if="heatmap?.months?.length">
          <button
            v-for="month in heatmap.months"
            :key="month.month_key"
            type="button"
            :class="['heat-cell', `heat-${heatLevel(month.total_media)}`]"
            @click="openMonth(month.month_key)"
          >
            <span class="heat-label">{{ month.label }}</span>
            <strong class="heat-total">{{ month.total_media }}</strong>
            <span class="cycle-chip">{{ formatCycleRange(month.cycle_start, month.cycle_end, 'compact') }}</span>
            <span class="muted heat-foot">{{ month.active_users }} active</span>
          </button>
        </div>
        <div v-else class="muted">No monthly data available yet.</div>
      </div>

      <div class="card">
        <div class="section-row">
          <div class="section-heading">
            <h3>No Image Upload This Month</h3>
            <div class="muted">
              Active users with 0 uploaded photos in {{ formatMonthLabel(missingUsers?.month) }}
              <span v-if="missingUsers">({{ formatCycleRange(missingUsers.cycle_start, missingUsers.cycle_end) }})</span>
            </div>
          </div>
          <div class="selection-tools">
            <button class="btn-secondary" type="button" @click="selectAllMissing" :disabled="!missingUsers?.items.length">
              Select All
            </button>
            <button class="btn-secondary" type="button" @click="clearMissingSelection" :disabled="!missingSelectedIds.length">
              Clear
            </button>
            <span class="muted">Selected: {{ missingSelectedIds.length }}</span>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="checkbox-cell"></th>
                <th>User</th>
                <th>Username</th>
                <th>Chat</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in missingUsers?.items ?? []" :key="item.user_tu_id">
                <td class="checkbox-cell">
                  <input type="checkbox" :value="item.user_tu_id" v-model="missingSelectedIds" />
                </td>
                <td>
                  <strong>{{ item.tu_name }}</strong>
                  <div class="muted">{{ item.tu_id }}</div>
                </td>
                <td>{{ item.telegram_username ? `@${item.telegram_username}` : 'no_username' }}</td>
                <td>{{ item.telegram_chat_id }}</td>
              </tr>
              <tr v-if="!(missingUsers?.items?.length)">
                <td colspan="4" class="muted">Every active user has uploaded at least one photo this month.</td>
              </tr>
            </tbody>
          </table>
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

    <button
      v-if="missingSelectedIds.length"
      type="button"
      class="floating-send"
      @click="sendSelectedToMessages(missingSelectedIds)"
    >
      Send Message ({{ missingSelectedIds.length }})
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  apiGet,
  storeDashboardSelectedTargetIds,
  type DashboardOverview,
  type MissingImageUsersResponse,
  type MonthlyHeatmapResponse,
} from '../services/api';
import { formatCycleRange, formatCycleRule } from '../utils/reportingCycle';

const router = useRouter();
const overview = ref<DashboardOverview | null>(null);
const heatmap = ref<MonthlyHeatmapResponse | null>(null);
const missingUsers = ref<MissingImageUsersResponse | null>(null);
const missingSelectedIds = ref<number[]>([]);
const loading = ref(false);
const errorMsg = ref('');

const currentYear = computed(() => new Date().getFullYear());
const heatMax = computed(() => {
  const totals = heatmap.value?.months.map((item) => item.total_media) ?? [];
  return Math.max(0, ...totals);
});

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatMonthLabel(monthKey?: string | null): string {
  if (!monthKey) {
    return 'this month';
  }

  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) {
    return monthKey;
  }

  const value = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function heatLevel(total: number): number {
  if (total <= 0 || heatMax.value <= 0) {
    return 0;
  }

  return Math.min(4, Math.max(1, Math.ceil((total / heatMax.value) * 4)));
}

function openMonth(monthKey: string): void {
  void router.push(`/dashboard/month/${monthKey}`);
}

function selectAllMissing(): void {
  const ids = (missingUsers.value?.items ?? []).map((item) => item.user_tu_id);
  missingSelectedIds.value = [...new Set(ids)];
}

function clearMissingSelection(): void {
  missingSelectedIds.value = [];
}

function sendSelectedToMessages(ids: number[]): void {
  storeDashboardSelectedTargetIds(ids);
  void router.push({ path: '/messages', query: { source: 'dashboard' } });
}

async function loadDashboard(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';

  const [overviewResult, heatmapResult, missingResult] = await Promise.allSettled([
    apiGet<DashboardOverview>('/api/dashboard/overview'),
    apiGet<MonthlyHeatmapResponse>('/api/dashboard/monthly-heatmap'),
    apiGet<MissingImageUsersResponse>('/api/dashboard/current-month/missing-image-users?sortBy=tu_name&sortOrder=asc&limit=500&offset=0'),
  ]);

  const errors: string[] = [];

  if (overviewResult.status === 'fulfilled') {
    overview.value = overviewResult.value;
  } else {
    errors.push(overviewResult.reason instanceof Error ? overviewResult.reason.message : String(overviewResult.reason));
  }

  if (heatmapResult.status === 'fulfilled') {
    heatmap.value = heatmapResult.value;
  } else {
    errors.push(heatmapResult.reason instanceof Error ? heatmapResult.reason.message : String(heatmapResult.reason));
  }

  if (missingResult.status === 'fulfilled') {
    missingUsers.value = missingResult.value;
    const validIds = new Set(missingResult.value.items.map((item) => item.user_tu_id));
    missingSelectedIds.value = missingSelectedIds.value.filter((id) => validIds.has(id));
  } else {
    errors.push(missingResult.reason instanceof Error ? missingResult.reason.message : String(missingResult.reason));
  }

  errorMsg.value = errors.join('\n');
  loading.value = false;
}

onMounted(() => {
  void loadDashboard();
});
</script>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 96px;
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
  flex-wrap: wrap;
}

h2,
h3 {
  margin: 0;
}

.section-heading {
  display: grid;
  gap: 4px;
}

.section-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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

.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 6px 10px;
  background: #172033;
  color: #bfdbfe;
  font-size: 12px;
}

.selection-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.heat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.heat-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-height: 136px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid #31415a;
  background: #0f172a;
  color: #e5e7eb;
  cursor: pointer;
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}

.heat-cell:hover {
  transform: translateY(-1px);
  border-color: #60a5fa;
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.28);
}

.heat-label {
  font-size: 13px;
  color: #bfdbfe;
}

.heat-total {
  font-size: 32px;
  line-height: 1;
}

.cycle-chip {
  display: inline-flex;
  align-items: center;
  padding: 5px 9px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.45);
  color: #dbeafe;
  font-size: 12px;
  line-height: 1.2;
}

.heat-foot {
  margin-top: auto;
  font-size: 12px;
}

.heat-0 {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.78));
}

.heat-1 {
  background: linear-gradient(180deg, rgba(18, 44, 80, 0.95), rgba(17, 24, 39, 0.92));
}

.heat-2 {
  background: linear-gradient(180deg, rgba(18, 74, 112, 0.95), rgba(17, 24, 39, 0.92));
}

.heat-3 {
  background: linear-gradient(180deg, rgba(20, 102, 129, 0.95), rgba(17, 24, 39, 0.92));
}

.heat-4 {
  background: linear-gradient(180deg, rgba(22, 163, 74, 0.95), rgba(17, 24, 39, 0.92));
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

.checkbox-cell {
  width: 42px;
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

.btn-secondary {
  background: #1e293b;
}

.floating-send {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 20;
  border-radius: 999px;
  padding: 14px 18px;
  background: #16a34a;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
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

  .section-row,
  .top-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .floating-send {
    left: 16px;
    right: 16px;
    bottom: 16px;
    width: calc(100% - 32px);
  }
}
</style>
