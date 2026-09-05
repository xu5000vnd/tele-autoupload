<template>
  <section class="stack">
    <div class="card top-row">
      <div>
        <h2>Users</h2>
        <div class="muted">Manage TU users used by upload tracking and broadcast targets.</div>
      </div>
      <div class="actions">
        <button class="btn-secondary" :disabled="loading || importing" type="button" @click="loadUsers">
          {{ loading ? 'Loading...' : 'Reload' }}
        </button>
        <label class="btn-secondary csv-import-button">
          <input
            class="csv-import-input"
            :disabled="loading || importing"
            accept=".csv,text/csv"
            type="file"
            @change="importCsv"
          />
          {{ importing ? 'Importing...' : 'Import CSV' }}
        </label>
        <button type="button" @click="startCreate">New User</button>
      </div>
    </div>

    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
    <p v-if="successMsg" class="ok">{{ successMsg }}</p>
    <div v-if="manualReview.length" class="manual-review">
      <strong>Manual review needed</strong>
      <ul>
        <li v-for="review in manualReview" :key="`${review.tu_id}:${review.telegram_username}`">
          {{ review.tu_name }} ({{ review.tu_id }}) — @{{ review.telegram_username }}:
          {{ review.reason === 'invalid_username' ? 'invalid username' : 'username not occupied' }}
        </li>
      </ul>
    </div>

    <div class="layout">
      <section class="card">
        <div class="list-heading">
          <div>
            <h3>User List</h3>
            <div class="muted">{{ filteredUsers.length }} shown · {{ users.length }} loaded</div>
          </div>
        </div>

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
                <td data-label="User">
                  <RouterLink class="user-name-link" :to="`/users/${user.id}`">
                    <strong>{{ user.tu_name }}</strong>
                  </RouterLink>
                  <div class="muted">{{ user.tu_id }}</div>
                  <div class="muted path-text">{{ user.path || 'no path' }}</div>
                </td>
                <td data-label="Telegram">
                  <div>{{ user.telegram_chat_id }}</div>
                  <div class="muted">
                    {{ user.telegram_username ? `@${user.telegram_username}` : 'no_username' }}
                  </div>
                  <div class="muted">{{ user.telegram_user_id }}</div>
                </td>
                <td data-label="Status">
                  <span :class="['status', user.status ?? 'active']">{{ user.status ?? 'active' }}</span>
                </td>
                <td class="action-cell" data-label="Actions">
                  <div class="row-actions">
                    <button class="btn-secondary" type="button" @click="editUser(user)">Edit</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!filteredUsers.length" class="empty-row">
                <td colspan="4" class="muted">No users found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div v-if="formOpen" class="modal-backdrop" @click.self="closeForm">
        <section class="modal-card">
          <div class="form-heading">
            <div>
              <h3>{{ editingId ? 'Update User' : 'Add User' }}</h3>
              <div class="muted">Manage Telegram identity and upload tracking metadata.</div>
            </div>
            <button class="btn-secondary icon-button" type="button" aria-label="Close" @click="closeForm">x</button>
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

            <div class="form-grid">
              <label>
                <span>Telegram Chat ID</span>
                <input v-model="form.telegram_chat_id" type="text" required />
              </label>

              <label>
                <span>Telegram User ID</span>
                <input v-model="form.telegram_user_id" type="text" required />
              </label>
            </div>

            <label>
              <span>Telegram Username</span>
              <div class="username-resolver">
                <input v-model="form.telegram_username" :disabled="resolvingUsername" type="text" placeholder="@username" />
                <button
                  class="btn-secondary"
                  :disabled="saving || resolvingUsername || !normalizedUsername"
                  type="button"
                  @click="resolveUsername"
                >
                  {{ resolvingUsername ? 'Resolving...' : 'Resolve' }}
                </button>
              </div>
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

            <div class="modal-actions">
              <button class="btn-secondary" :disabled="resolvingUsername" type="button" @click="closeForm">Cancel</button>
              <button :disabled="saving || resolvingUsername" type="submit">
                {{ saving ? 'Saving...' : editingId ? 'Update User' : 'Add User' }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  addTarget,
  importTargets,
  listTargets,
  resolveTelegramUsername,
  type ImportManualReviewRecord,
  updateTarget,
  type ImportTargetRequest,
  type SaveTargetRequest,
  type Target,
} from '../services/api';

type StatusFilter = 'active' | 'inactive' | 'all';
type CsvRecord = { fields: string[]; line: number };
type ParsedImportCsv = {
  targets: ImportTargetRequest[];
  skipped: number;
};

const IMPORT_HEADERS = [
  'tu_id',
  'telegram_chat_id',
  'telegram_username',
  'telegram_user_id',
  'tu_name',
  'path',
];

const users = ref<Target[]>([]);
const filteredUsers = ref<Target[]>([]);
const loading = ref(false);
const saving = ref(false);
const importing = ref(false);
const resolvingUsername = ref(false);
const search = ref('');
const statusFilter = ref<StatusFilter>('all');
const editingId = ref<number | null>(null);
const formOpen = ref(false);
const errorMsg = ref('');
const successMsg = ref('');
const manualReview = ref<ImportManualReviewRecord[]>([]);

const form = reactive({
  tu_id: '',
  tu_name: '',
  telegram_chat_id: '',
  telegram_user_id: '',
  telegram_username: '',
  path: '',
  status: 'active' as 'active' | 'inactive',
});

const normalizedUsername = computed(() => form.telegram_username.trim().replace(/^@+/, '').toLowerCase());

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

function parseCsvRecords(content: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let inQuotes = false;
  let afterQuote = false;
  let quoteLine = 1;

  const finishRecord = (): void => {
    fields.push(field);
    if (fields.length > 1 || fields[0].trim()) {
      records.push({ fields, line: recordLine });
    }
    fields = [];
    field = '';
    afterQuote = false;
    recordLine = line + 1;
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && next === '\n') {
          index += 1;
        }
        field += '\n';
        line += 1;
      } else {
        field += char;
      }
      continue;
    }

    if (afterQuote) {
      if (char === ',') {
        fields.push(field);
        field = '';
        afterQuote = false;
      } else if (char === '\r' || char === '\n') {
        finishRecord();
        if (char === '\r' && next === '\n') {
          index += 1;
        }
        line += 1;
      } else if (char !== ' ' && char !== '\t') {
        throw new Error(`Line ${line}: unexpected character after closing quote`);
      }
      continue;
    }

    if (char === '"') {
      if (field) {
        throw new Error(`Line ${line}: unexpected quote`);
      }
      inQuotes = true;
      quoteLine = line;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      finishRecord();
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      line += 1;
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error(`Line ${quoteLine}: missing closing quote`);
  }
  if (fields.length || field) {
    finishRecord();
  }

  return records;
}

function requireCsvValue(value: string, field: string, line: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Line ${line}: ${field} is required`);
  }
  return trimmed;
}

function parseInteger(value: string, field: string, line: number): string {
  const trimmed = requireCsvValue(value, field, line);
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`Line ${line}: ${field} must be an integer`);
  }
  return trimmed;
}

function parseImportCsv(content: string): ParsedImportCsv {
  const records = parseCsvRecords(content.replace(/^\uFEFF/, ''));
  if (!records.length) {
    throw new Error('CSV is empty');
  }

  const header = records[0].fields.map((field) => field.trim());
  if (header.length !== IMPORT_HEADERS.length || header.some((field, index) => field !== IMPORT_HEADERS[index])) {
    throw new Error(`CSV header must be: ${IMPORT_HEADERS.join(', ')}`);
  }

  const tuIdLines = new Map<string, number>();
  const telegramIdentityLines = new Map<string, number>();
  const targets: ImportTargetRequest[] = [];
  let skipped = 0;
  for (const { fields, line } of records.slice(1)) {
    if (fields.length !== IMPORT_HEADERS.length) {
      throw new Error(`Line ${line}: expected ${IMPORT_HEADERS.length} columns`);
    }

    const [tuIdRaw, chatIdRaw, usernameRaw, userIdRaw, tuNameRaw, pathRaw] = fields.map((field) => field.trim());
    if (!pathRaw) {
      skipped += 1;
      continue;
    }

    const username = usernameRaw.replace(/^@+/, '').toLowerCase() || null;
    const telegramUserId = userIdRaw ? parseInteger(userIdRaw, 'telegram_user_id', line) : '';
    if (!username && (!telegramUserId || BigInt(telegramUserId) === 0n)) {
      skipped += 1;
      continue;
    }

    const tuId = requireCsvValue(tuIdRaw, 'tu_id', line);
    const telegramChatId = parseInteger(chatIdRaw, 'telegram_chat_id', line);
    const existingTuIdLine = tuIdLines.get(tuId);
    if (existingTuIdLine !== undefined) {
      throw new Error(`Line ${line}: duplicate tu_id ${tuId} (first used on line ${existingTuIdLine})`);
    }

    if (telegramUserId && BigInt(telegramUserId) !== 0n) {
      const identity = `${telegramUserId}:${telegramChatId}`;
      const existingIdentityLine = telegramIdentityLines.get(identity);
      if (existingIdentityLine !== undefined) {
        throw new Error(`Line ${line}: duplicate telegram user/chat pair (first used on line ${existingIdentityLine})`);
      }
      telegramIdentityLines.set(identity, line);
    }

    tuIdLines.set(tuId, line);
    targets.push({
      tu_id: tuId,
      tu_name: requireCsvValue(tuNameRaw, 'tu_name', line),
      telegram_chat_id: telegramChatId,
      telegram_user_id: telegramUserId,
      telegram_username: username,
      path: pathRaw || null,
      status: 'active' as const,
    });
  }

  return { targets, skipped };
}

async function loadUsers(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  try {
    users.value = await listTargets('', statusFilter.value);
    applyLocalFilter();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function importCsv(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || importing.value) {
    return;
  }

  importing.value = true;
  errorMsg.value = '';
  successMsg.value = '';
  manualReview.value = [];

  try {
    const { targets, skipped } = parseImportCsv(await file.text());
    if (!targets.length) {
      successMsg.value = `Imported 0 users: 0 created, 0 updated, 0 IDs resolved, ${skipped} skipped.`;
      return;
    }

    const result = await importTargets(targets);
    manualReview.value = result.manual_review;
    successMsg.value = `Imported ${result.total} users: ${result.created} created, ${result.updated} updated, ${result.resolved} IDs resolved, ${skipped} skipped, ${result.manual_review.length} need manual review.`;
    await loadUsers();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    importing.value = false;
    input.value = '';
  }
}

function startCreate(): void {
  editingId.value = null;
  formOpen.value = true;
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
  formOpen.value = true;
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

function closeForm(): void {
  if (resolvingUsername.value) {
    return;
  }
  formOpen.value = false;
}

async function resolveUsername(): Promise<void> {
  if (saving.value || resolvingUsername.value || !normalizedUsername.value) {
    return;
  }

  resolvingUsername.value = true;
  errorMsg.value = '';
  successMsg.value = '';

  try {
    const resolved = await resolveTelegramUsername({
      telegram_username: form.telegram_username,
    });
    form.telegram_username = resolved.telegram_username;
    form.telegram_user_id = resolved.telegram_user_id;
    successMsg.value = `Resolved @${resolved.telegram_username}.`;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    resolvingUsername.value = false;
  }
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
    formOpen.value = false;
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
  padding: 18px;
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
  display: block;
}

.list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 14px;
  align-items: end;
  margin-bottom: 18px;
}

.filters label {
  min-width: 0;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #cbd5e1;
  font-size: 14px;
  font-weight: 700;
}

input,
select {
  box-sizing: border-box;
  width: 100%;
  background: #0b1220;
  color: #e5e7eb;
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 11px 12px;
  font: inherit;
  font-weight: 500;
}

input:focus,
select:focus {
  outline: 2px solid rgba(147, 197, 253, 0.28);
  border-color: #60a5fa;
}

.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
}

th,
td {
  text-align: left;
  padding: 12px 16px;
  border-bottom: 1px solid #263244;
  vertical-align: top;
}

th {
  color: #93c5fd;
  font-size: 14px;
  letter-spacing: 0.01em;
}

tr.selected {
  background: rgba(37, 99, 235, 0.12);
}

.path-text {
  max-width: 520px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-cell {
  text-align: right;
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.user-name-link {
  color: #e5e7eb;
  text-decoration: none;
}

.user-name-link:hover {
  color: #93c5fd;
  text-decoration: underline;
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
  width: min(680px, calc(100vw - 48px));
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

.user-form {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.username-resolver {
  display: flex;
  gap: 10px;
}

.username-resolver input {
  min-width: 0;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.csv-import-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  color: #fff;
  cursor: pointer;
}

.csv-import-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
  white-space: nowrap;
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

.manual-review {
  border: 1px solid #facc15;
  border-radius: 8px;
  color: #fef3c7;
  padding: 12px 16px;
}

.manual-review ul {
  margin: 8px 0 0;
  padding-left: 20px;
}

.err {
  white-space: pre-wrap;
}

@media (max-width: 980px) {
  .filters {
    grid-template-columns: 1fr;
  }

  .status-filter {
    max-width: none;
  }
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

  tbody tr.selected {
    background: rgba(37, 99, 235, 0.16);
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

  .path-text {
    max-width: none;
    white-space: normal;
    overflow-wrap: anywhere;
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

  .username-resolver {
    flex-direction: column;
  }

  .username-resolver button {
    width: 100%;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .modal-actions button {
    width: 100%;
  }
}
</style>
