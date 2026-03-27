<template>
  <section class="card">
    <h2>Broadcast Messages</h2>

    <div class="field">
      <label>Recipients (multi checkbox)</label>
      <div class="row" style="margin-bottom: 8px">
        <button class="btn-secondary" @click="selectAllVisible" type="button">
          Select All
        </button>
        <button class="btn-secondary" @click="clearSelection" type="button">
          Clear
        </button>
        <span class="muted">Total selected: {{ selectedIds.length }}</span>
      </div>
      <div class="row" style="margin-bottom: 8px">
        <input
          v-model="search"
          type="text"
          placeholder="Search tu_name / tu_id / username"
          @input="applyFilter"
        />
      </div>
      <div class="target-list">
        <label v-for="t in filteredTargets" :key="t.id" class="target-item">
          <input type="checkbox" :value="t.id" v-model="selectedIds" />
          <span>
            <b>{{ t.tu_name }}</b>
            <small class="muted"
              >{{ t.telegram_chat_id }} / @{{
                t.telegram_username || "no_username"
              }}</small
            >
          </span>
        </label>
        <div v-if="!filteredTargets.length" class="muted">
          No targets found.
        </div>
      </div>
    </div>

    <div class="field">
      <label>Body</label>
      <textarea v-model="body" placeholder="Hello {{tu_name}}"></textarea>
    </div>

    <div class="field">
      <label>Upload multiple media</label>
      <input ref="fileInput" type="file" multiple @change="onFileChange" />
      <div class="muted" v-if="mediaItems.length">
        {{ mediaItems.length }} file(s) selected
      </div>
      <div v-if="mediaItems.length" class="media-preview-list">
        <div v-for="item in mediaItems" :key="item.id" class="media-preview-item">
          <img v-if="item.previewUrl" :src="item.previewUrl" :alt="item.file.name" />
          <div v-else class="file-placeholder">{{ item.file.name }}</div>
          <button type="button" class="remove-btn" @click="removeMedia(item.id)">x</button>
          <div class="file-name">{{ item.file.name }}</div>
        </div>
      </div>
    </div>

    <div class="field">
      <label>Preview (first selected user)</label>
      <pre>{{ previewBody }}</pre>
    </div>

    <div class="row">
      <button :disabled="submitting" @click="submit">
        {{ submitting ? "Submitting..." : "Submit" }}
      </button>
      <span class="ok" v-if="successMsg">{{ successMsg }}</span>
      <span class="err" v-if="errorMsg">{{ errorMsg }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { apiGet, apiPost, fileToBase64, type Target } from "../services/api";

type CreateCampaignResponse = {
  campaign_id: string;
  total_targets: number;
  media_count: number;
  status: string;
};

type SelectedMedia = {
  id: string;
  file: File;
  previewUrl: string | null;
};

const targets = ref<Target[]>([]);
const filteredTargets = ref<Target[]>([]);
const selectedIds = ref<number[]>([]);
const loadingTargets = ref(false);
const submitting = ref(false);
const search = ref("");
const body = ref("");
const mediaItems = ref<SelectedMedia[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const successMsg = ref("");
const errorMsg = ref("");

const previewBody = computed(() => {
  const first = targets.value.find((t) => selectedIds.value.includes(t.id));
  if (!first) {
    return "Select one target to preview template output.";
  }
  return renderTemplate(body.value, first);
});

function renderTemplate(template: string, target: Target): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_m, key: string) => {
    const context: Record<string, string> = {
      tu_name: target.tu_name,
      tu_id: target.tu_id,
      telegram_username: target.telegram_username ?? "",
      telegram_user_id: target.telegram_user_id,
      telegram_chat_id: target.telegram_chat_id,
    };
    return context[key] ?? "";
  });
}

function applyFilter(): void {
  const q = search.value.trim().toLowerCase();
  if (!q) {
    filteredTargets.value = [...targets.value];
    return;
  }

  filteredTargets.value = targets.value.filter((t) => {
    return (
      t.tu_name.toLowerCase().includes(q) ||
      t.tu_id.toLowerCase().includes(q) ||
      (t.telegram_username ?? "").toLowerCase().includes(q) ||
      t.telegram_chat_id.includes(q)
    );
  });
}

async function loadTargets(): Promise<void> {
  loadingTargets.value = true;
  errorMsg.value = "";
  try {
    const data = await apiGet<Target[]>(
      `/api/messages/targets?query=${encodeURIComponent(search.value || "")}`,
    );
    targets.value = data;
    applyFilter();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingTargets.value = false;
  }
}

function selectAllVisible(): void {
  const set = new Set(selectedIds.value);
  filteredTargets.value.forEach((t) => set.add(t.id));
  selectedIds.value = [...set];
}

function clearSelection(): void {
  selectedIds.value = [];
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const picked = Array.from(input.files ?? []);
  if (!picked.length) {
    return;
  }

  const nextItems = picked.map((file) => ({
    id: `${file.name}-${file.lastModified}-${Math.random().toString(16).slice(2)}`,
    file,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
  }));

  mediaItems.value = [...mediaItems.value, ...nextItems];
  input.value = "";
}

function removeMedia(id: string): void {
  const idx = mediaItems.value.findIndex((item) => item.id === id);
  if (idx < 0) {
    return;
  }

  const [removed] = mediaItems.value.splice(idx, 1);
  if (removed.previewUrl) {
    URL.revokeObjectURL(removed.previewUrl);
  }
}

function clearAllMedia(): void {
  mediaItems.value.forEach((item) => {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
  });
  mediaItems.value = [];
}

async function submit(): Promise<void> {
  submitting.value = true;
  successMsg.value = "";
  errorMsg.value = "";

  try {
    const media = await Promise.all(
      mediaItems.value.map((item) => fileToBase64(item.file)),
    );
    const payload = {
      targetIds: selectedIds.value,
      body: body.value,
      media,
    };

    const result = await apiPost<CreateCampaignResponse>(
      "/api/messages",
      payload,
    );
    successMsg.value = `Campaign ${result.campaign_id} queued for ${result.total_targets} target(s).`;

    if (fileInput.value) {
      fileInput.value.value = "";
    }
    clearAllMedia();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void loadTargets();
});

onUnmounted(() => {
  clearAllMedia();
});
</script>

<style scoped>
.card {
  background: rgba(17, 24, 39, 0.92);
  border: 1px solid #263244;
  border-radius: 14px;
  padding: 16px;
}

h2 {
  margin-top: 0;
}

.field {
  margin-bottom: 14px;
}

label {
  display: block;
  margin-bottom: 6px;
  color: #cbd5e1;
}

input[type="text"],
textarea,
input[type="file"] {
  width: 100%;
  background: #0b1220;
  color: #e5e7eb;
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 10px;
}

textarea {
  min-height: 120px;
  resize: vertical;
}

.row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

button {
  background: #16a34a;
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

.target-list {
  max-height: 260px;
  overflow: auto;
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 8px;
  background: #0b1220;
}

.target-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.media-preview-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.media-preview-item {
  position: relative;
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 6px;
  background: #0b1220;
}

.media-preview-item img,
.file-placeholder {
  display: block;
  width: 100%;
  height: 90px;
  object-fit: cover;
  border-radius: 6px;
  background: #111827;
}

.file-placeholder {
  color: #cbd5e1;
  font-size: 12px;
  padding: 8px;
  overflow: hidden;
}

.remove-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  padding: 0;
  background: #ef4444;
  line-height: 1;
}

.file-name {
  margin-top: 6px;
  font-size: 12px;
  color: #cbd5e1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

pre {
  white-space: pre-wrap;
  background: #0b1220;
  border: 1px solid #263244;
  border-radius: 8px;
  padding: 10px;
  margin: 0;
  min-height: 80px;
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
</style>
