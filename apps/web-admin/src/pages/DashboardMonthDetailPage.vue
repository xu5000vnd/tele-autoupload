<template>
  <section class="stack">
    <div class="card top-row">
      <div class="header-copy">
        <h2>Month Detail</h2>
        <div class="muted">{{ formatMonthLabel(detail?.month ?? monthKey) }}</div>
        <div class="header-meta" v-if="detail">
          <span class="pill">{{ formatCycleRange(detail.cycle_start, detail.cycle_end) }}</span>
          <span class="pill">{{ formatCycleRule(detail.cycle_close_day) }}</span>
          <span class="pill">{{ detail.timezone }}</span>
        </div>
      </div>
      <div class="actions">
        <RouterLink class="back-link" to="/dashboard">Back to Dashboard</RouterLink>
        <button :disabled="loading" @click="loadDetail">{{ loading ? 'Loading...' : 'Reload' }}</button>
      </div>
    </div>

    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>

    <div v-if="loading && !detail" class="card muted">Loading month detail...</div>

    <template v-if="detail">
      <div class="summary-grid">
        <div class="card summary-card">
          <div class="summary-label">Total Media</div>
          <div class="summary-value">{{ detail.summary.total_media }}</div>
        </div>
        <div class="card summary-card">
          <div class="summary-label">Active Users</div>
          <div class="summary-value">{{ detail.summary.active_users }}</div>
        </div>
        <div class="card summary-card">
          <div class="summary-label">Selection</div>
          <div class="summary-value">{{ selectedIds.length }}</div>
        </div>
      </div>

      <div class="card">
        <div class="top-row">
          <div class="section-copy">
            <h3>User Upload Totals</h3>
            <div class="muted">Sortable reporting-cycle totals for every active user</div>
          </div>
          <div class="actions">
            <button class="btn-secondary" type="button" @click="selectAllVisible" :disabled="!detail.items.length">
              Select All
            </button>
            <button class="btn-secondary" type="button" @click="clearSelection" :disabled="!selectedIds.length">
              Clear
            </button>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="checkbox-cell"></th>
                <th>
                  <button class="sort-btn" type="button" @click="changeSort('tu_name')">
                    User {{ sortIndicator('tu_name') }}
                  </button>
                </th>
                <th>
                  <button class="sort-btn" type="button" @click="changeSort('telegram_username')">
                    Username {{ sortIndicator('telegram_username') }}
                  </button>
                </th>
                <th>Chat</th>
                <th>
                  <button class="sort-btn" type="button" @click="changeSort('total_media')">
                    Total {{ sortIndicator('total_media') }}
                  </button>
                </th>
                <th>
                  <button class="sort-btn" type="button" @click="changeSort('image_count')">
                    Images {{ sortIndicator('image_count') }}
                  </button>
                </th>
                <th>
                  <button class="sort-btn" type="button" @click="changeSort('video_count')">
                    Videos {{ sortIndicator('video_count') }}
                  </button>
                </th>
                <th>
                  <button class="sort-btn" type="button" @click="changeSort('document_count')">
                    Docs {{ sortIndicator('document_count') }}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in detail.items" :key="item.user_tu_id">
                <td class="checkbox-cell">
                  <input type="checkbox" :value="item.user_tu_id" v-model="selectedIds" />
                </td>
                <td>
                  <strong>{{ item.tu_name }}</strong>
                  <div class="muted">{{ item.tu_id }}</div>
                </td>
                <td>{{ item.telegram_username ? `@${item.telegram_username}` : 'no_username' }}</td>
                <td>{{ item.telegram_chat_id }}</td>
                <td>{{ item.total_media }}</td>
                <td>{{ item.image_count }}</td>
                <td>{{ item.video_count }}</td>
                <td>{{ item.document_count }}</td>
              </tr>
              <tr v-if="!detail.items.length">
                <td colspan="8" class="muted">No active users found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <button
      v-if="selectedIds.length"
      type="button"
      class="floating-send"
      @click="sendSelectedToMessages"
    >
      Send Message ({{ selectedIds.length }})
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  apiGet,
  storeDashboardSelectedTargetIds,
  type DashboardMonthUsersResponse,
} from '../services/api';
import { formatCycleRange, formatCycleRule } from '../utils/reportingCycle';

type SortField =
  | 'tu_name'
  | 'telegram_username'
  | 'total_media'
  | 'image_count'
  | 'video_count'
  | 'document_count';

const route = useRoute();
const router = useRouter();
const detail = ref<DashboardMonthUsersResponse | null>(null);
const selectedIds = ref<number[]>([]);
const loading = ref(false);
const errorMsg = ref('');
const sortBy = ref<SortField>('total_media');
const sortOrder = ref<'asc' | 'desc'>('desc');

const monthKey = computed(() => String(route.params.monthKey ?? ''));

function formatMonthLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function sortIndicator(field: SortField): string {
  if (sortBy.value !== field) {
    return '';
  }
  return sortOrder.value === 'asc' ? '↑' : '↓';
}

function changeSort(field: SortField): void {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy.value = field;
    sortOrder.value = field === 'tu_name' || field === 'telegram_username' ? 'asc' : 'desc';
  }

  void loadDetail();
}

function selectAllVisible(): void {
  selectedIds.value = [...new Set(detail.value?.items.map((item) => item.user_tu_id) ?? [])];
}

function clearSelection(): void {
  selectedIds.value = [];
}

function sendSelectedToMessages(): void {
  storeDashboardSelectedTargetIds(selectedIds.value);
  void router.push({ path: '/messages', query: { source: 'dashboard' } });
}

async function loadDetail(): Promise<void> {
  if (!monthKey.value) {
    errorMsg.value = 'Missing month key.';
    return;
  }

  loading.value = true;
  errorMsg.value = '';

  try {
    const query = new URLSearchParams({
      sortBy: sortBy.value,
      sortOrder: sortOrder.value,
      limit: '500',
      offset: '0',
    });
    const data = await apiGet<DashboardMonthUsersResponse>(
      `/api/dashboard/months/${encodeURIComponent(monthKey.value)}/users?${query.toString()}`,
    );
    detail.value = data;
    const validIds = new Set(data.items.map((item) => item.user_tu_id));
    selectedIds.value = selectedIds.value.filter((id) => validIds.has(id));
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => route.params.monthKey,
  () => {
    clearSelection();
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
  padding-bottom: 96px;
}

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
  gap: 12px;
  flex-wrap: wrap;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.back-link {
  color: #93c5fd;
  text-decoration: none;
}

.header-copy,
.section-copy {
  display: grid;
  gap: 6px;
}

.header-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.summary-card {
  display: flex;
  flex-direction: column;
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

.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 6px 10px;
  background: #172033;
  color: #bfdbfe;
  font-size: 12px;
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

.sort-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
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

@media (max-width: 900px) {
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
