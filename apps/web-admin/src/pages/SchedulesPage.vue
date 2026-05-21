<template>
  <section class="stack">
    <div class="card top-row">
      <div>
        <h2>Schedules</h2>
        <div class="muted">Create, update, and trigger upload reminder schedules.</div>
      </div>
      <div class="actions">
        <button class="btn-secondary" type="button" :disabled="loading" @click="loadSchedules">
          {{ loading ? 'Loading...' : 'Reload' }}
        </button>
        <button type="button" @click="startCreate">New Schedule</button>
      </div>
    </div>

    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
    <p v-if="successMsg" class="ok">{{ successMsg }}</p>

    <section class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Schedule</th>
              <th>Timing</th>
              <th>Target</th>
              <th>Last Run</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="schedule in schedules"
              :key="schedule.id"
              :class="{ selected: schedule.id === editingId }"
            >
              <td data-label="Schedule">
                <strong>{{ schedule.name }}</strong>
                <div>
                  <span :class="['status', schedule.status]">{{ schedule.status }}</span>
                </div>
              </td>
              <td data-label="Timing">
                <div>{{ schedule.days_of_month.join(', ') }} at {{ schedule.send_time }}</div>
                <div class="muted">{{ schedule.timezone }}</div>
                <div class="muted">{{ schedule.next_run_label || 'No upcoming run' }}</div>
              </td>
              <td data-label="Target">{{ targetRuleLabel(schedule.target_rule) }}</td>
              <td data-label="Last Run">
                <div>{{ schedule.last_run_at ? formatDateTime(schedule.last_run_at) : 'Never' }}</div>
                <div v-if="schedule.recent_runs[0]" class="muted">
                  {{ schedule.recent_runs[0].status }} · {{ schedule.recent_runs[0].target_count }} targets
                </div>
              </td>
              <td class="action-cell" data-label="Actions">
                <div class="row-actions">
                  <button
                    class="btn-secondary"
                    type="button"
                    :disabled="runningId === schedule.id"
                    @click="runNow(schedule)"
                  >
                    {{ runningId === schedule.id ? 'Running...' : 'Run Now' }}
                  </button>
                  <button class="btn-secondary" type="button" @click="editSchedule(schedule)">Edit</button>
                </div>
              </td>
            </tr>
            <tr v-if="!schedules.length" class="empty-row">
              <td colspan="5" class="muted">No schedules found.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="formOpen" class="modal-backdrop" @click.self="closeForm">
        <section class="modal-card">
          <div class="form-heading">
            <div>
              <h3>{{ editingId ? 'Update Schedule' : 'Create Schedule' }}</h3>
              <div class="muted">Configure timing, audience, and reminder copy.</div>
            </div>
            <button class="btn-secondary icon-button" type="button" aria-label="Close" @click="closeForm">x</button>
          </div>

          <form class="schedule-form" @submit.prevent="saveSchedule">
            <label>
              <span>Name</span>
              <input v-model="form.name" type="text" required placeholder="10th and 15th upload reminder" />
            </label>

            <div class="form-grid">
              <label>
                <span>Status</span>
                <select v-model="form.status">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>

              <label>
                <span>Send Time</span>
                <input v-model="form.send_time" type="time" required />
              </label>
            </div>

            <label>
              <span>Days of Month</span>
              <input v-model="form.days_text" type="text" required placeholder="10, 15" />
            </label>

            <label>
              <span>Timezone</span>
              <input v-model="form.timezone" type="text" required />
            </label>

            <div class="field-group">
              <span>Target Rule</span>
              <div class="target-rule-control" role="radiogroup" aria-label="Target Rule">
                <button
                  type="button"
                  :class="{ selected: form.target_rule === 'no_media_current_period' }"
                  @click="form.target_rule = 'no_media_current_period'"
                >
                  No media uploaded this period
                </button>
                <button
                  type="button"
                  :class="{ selected: form.target_rule === 'all_active_users' }"
                  @click="form.target_rule = 'all_active_users'"
                >
                  All active users
                </button>
              </div>
            </div>

            <label>
              <span>Message Template</span>
              <textarea v-model="form.message_template" required />
            </label>

            <div class="template-help">
              <span v-for="token in templateTokens" :key="token">{{ token }}</span>
            </div>

            <div class="modal-actions">
              <button class="btn-secondary" type="button" @click="closeForm">Cancel</button>
              <button :disabled="saving" type="submit">
                {{ saving ? 'Saving...' : editingId ? 'Update Schedule' : 'Create Schedule' }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import {
  createReminderSchedule,
  listReminderSchedules,
  runReminderScheduleNow,
  updateReminderSchedule,
  type ReminderSchedule,
  type ReminderScheduleTargetRule,
  type SaveReminderScheduleRequest,
} from '../services/api';

const defaultTemplate = 'Hi {{tu_name}}, please upload your required media for this reporting period. Thank you.';
const templateTokens = ['{{tu_name}}', '{{tu_id}}', '{{telegram_username}}'];

const schedules = ref<ReminderSchedule[]>([]);
const loading = ref(false);
const saving = ref(false);
const runningId = ref<number | null>(null);
const editingId = ref<number | null>(null);
const formOpen = ref(false);
const errorMsg = ref('');
const successMsg = ref('');

const form = reactive({
  name: '',
  status: 'active' as 'active' | 'inactive',
  days_text: '10, 15',
  send_time: '09:00',
  timezone: 'Asia/Ho_Chi_Minh',
  target_rule: 'no_media_current_period' as ReminderScheduleTargetRule,
  message_template: defaultTemplate,
});

async function loadSchedules(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';

  try {
    schedules.value = await listReminderSchedules();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function startCreate(): void {
  editingId.value = null;
  formOpen.value = true;
  form.name = '';
  form.status = 'active';
  form.days_text = '10, 15';
  form.send_time = '09:00';
  form.timezone = 'Asia/Ho_Chi_Minh';
  form.target_rule = 'no_media_current_period';
  form.message_template = defaultTemplate;
  successMsg.value = '';
  errorMsg.value = '';
}

function editSchedule(schedule: ReminderSchedule): void {
  editingId.value = schedule.id;
  formOpen.value = true;
  form.name = schedule.name;
  form.status = schedule.status;
  form.days_text = schedule.days_of_month.join(', ');
  form.send_time = schedule.send_time;
  form.timezone = schedule.timezone;
  form.target_rule = schedule.target_rule === 'all_active_users' ? 'all_active_users' : 'no_media_current_period';
  form.message_template = schedule.message_template;
  successMsg.value = '';
  errorMsg.value = '';
}

function closeForm(): void {
  formOpen.value = false;
}

function parseDaysText(value: string): number[] {
  const days = [...new Set(
    value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item)),
  )].sort((a, b) => a - b);

  if (!days.length || days.some((day) => day < 1 || day > 31)) {
    throw new Error('Days of month must contain values from 1 to 31.');
  }

  return days;
}

function buildPayload(): SaveReminderScheduleRequest {
  return {
    name: form.name.trim(),
    status: form.status,
    days_of_month: parseDaysText(form.days_text),
    send_time: form.send_time,
    timezone: form.timezone.trim(),
    target_rule: form.target_rule,
    message_template: form.message_template.trim(),
  };
}

async function saveSchedule(): Promise<void> {
  saving.value = true;
  successMsg.value = '';
  errorMsg.value = '';

  try {
    const payload = buildPayload();
    const saved = editingId.value
      ? await updateReminderSchedule(editingId.value, payload)
      : await createReminderSchedule(payload);

    successMsg.value = `${saved.name} ${editingId.value ? 'updated' : 'created'}.`;
    await loadSchedules();
    editingId.value = saved.id;
    formOpen.value = false;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function runNow(schedule: ReminderSchedule): Promise<void> {
  runningId.value = schedule.id;
  successMsg.value = '';
  errorMsg.value = '';

  try {
    const run = await runReminderScheduleNow(schedule.id);
    successMsg.value = `${schedule.name} triggered: ${run.status} for ${run.target_count} target(s).`;
    await loadSchedules();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    runningId.value = null;
  }
}

function targetRuleLabel(rule: ReminderScheduleTargetRule): string {
  if (rule === 'no_media_current_period') {
    return 'No media uploaded this period';
  }
  if (rule === 'all_active_users') {
    return 'All active users';
  }
  return 'No media uploaded this period';
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

onMounted(() => {
  void loadSchedules();
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

.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  min-width: 860px;
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

.action-cell {
  text-align: right;
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
  overflow-x: hidden;
  background: #111827;
  border: 1px solid #334155;
  border-radius: 14px;
  padding: 18px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  color: #e5e7eb;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
}

.modal-card,
.modal-card * {
  box-sizing: border-box;
}

.schedule-form {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

label,
.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #cbd5e1;
}

input,
select,
textarea {
  box-sizing: border-box;
  width: 100%;
  background: #0b1220;
  color: #e5e7eb;
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 10px;
}

.target-rule-control {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.target-rule-control button {
  min-height: 42px;
  border: 1px solid #263244;
  background: #0b1220;
  color: #cbd5e1;
  text-align: left;
}

.target-rule-control button.selected {
  border-color: #60a5fa;
  background: rgba(37, 99, 235, 0.22);
  color: #eff6ff;
}

textarea {
  min-height: 120px;
  resize: vertical;
}

.template-help {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.template-help span {
  border-radius: 999px;
  background: #172033;
  color: #bfdbfe;
  padding: 5px 8px;
  font-size: 12px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
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

.icon-button {
  width: 36px;
  height: 36px;
  padding: 0;
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

@media (max-width: 720px) {
  .card {
    padding: 14px;
  }

  .modal-backdrop {
    align-items: end;
    padding: 12px;
  }

  .modal-card {
    width: 100%;
    max-height: 92vh;
    padding: 14px;
  }

  .table-wrap {
    overflow: visible;
  }

  table,
  thead,
  tbody,
  tr,
  td {
    display: block;
    width: 100%;
    min-width: 0;
  }

  table {
    border-collapse: separate;
    border-spacing: 0 10px;
  }

  thead {
    display: none;
  }

  tbody tr {
    border: 1px solid #263244;
    border-radius: 10px;
    background: #0b1220;
    overflow: hidden;
  }

  td {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid #263244;
  }

  td::before {
    content: attr(data-label);
    color: #93c5fd;
    font-size: 12px;
    font-weight: 700;
  }

  td:last-child {
    border-bottom: none;
  }

  .empty-row td {
    display: block;
  }

  .empty-row td::before {
    content: none;
  }

  .action-cell {
    text-align: left;
  }

  .row-actions {
    justify-content: flex-start;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .target-rule-control {
    grid-template-columns: 1fr;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .modal-actions button {
    width: 100%;
  }
}
</style>
