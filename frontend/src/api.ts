/**
 * api.ts — Typed wrappers around the backend REST API.
 *
 * Every function receives the current access token as its first argument.
 * user_id is never sent from the client — the backend derives it from the JWT.
 */

function authHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ── Chat ────────────────────────────────────────────────────────────────────

export async function sendChatMessage(
  token: string,
  message: string,
  isCrew = false,
  sessionId?: string | null,
): Promise<{ reply: string; user_id: string; session_id: string }> {
  const endpoint = isCrew ? '/api/crew-chat' : '/api/chat';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ message, session_id: sessionId ?? null }),
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  return res.json();
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  title: string;
  preview: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
}

export interface SessionDetail {
  id: string;
  title: string;
  messages: SessionMessage[];
  created_at: string;
}

export async function getSessions(token: string): Promise<ChatSession[]> {
  const res = await fetch('/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to load sessions: ${res.status}`);
  return res.json();
}

export async function getSession(token: string, id: string): Promise<SessionDetail> {
  const res = await fetch(`/api/sessions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to load session: ${res.status}`);
  return res.json();
}

export async function deleteSession(token: string, id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to delete session: ${res.status}`);
}

// ── Memories ─────────────────────────────────────────────────────────────────

export async function getMemories(token: string) {
  const res = await fetch('/api/memories', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load memories: ${res.status}`);
  return res.json();
}

export async function addMemory(token: string, content: string) {
  const res = await fetch('/api/memories', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ memory: content }),
  });
  if (!res.ok) throw new Error(`Failed to add memory: ${res.status}`);
  return res.json();
}

export async function deleteMemory(token: string, memoryId: string) {
  const res = await fetch(`/api/memories/${memoryId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to delete memory: ${res.status}`);
  return res.json();
}

export async function deleteAllMemories(token: string) {
  const res = await fetch('/api/memories', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to delete memories: ${res.status}`);
  return res.json();
}

// ── File Ingestion ────────────────────────────────────────────────────────────

export interface IngestResult {
  filename: string;
  file_type: string;
  chunks_stored: number;
  message: string;
}

export async function ingestFile(token: string, file: File): Promise<IngestResult> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/ingest', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Ingest failed: ${res.status}`);
  }
  return res.json();
}

export async function ingestMultipleFiles(token: string, files: File[]): Promise<IngestResult[]> {
  const formData = new FormData();
  files.forEach(f => formData.append('files', f));
  const res = await fetch('/api/ingest/multiple', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Ingest failed: ${res.status}`);
  }
  return res.json();
}

// ── Image Generation ──────────────────────────────────────────────────────────

export interface ImageGenResult {
  url: string;
  prompt: string;
  width: number;
  height: number;
}

export async function generateImage(
  token: string,
  prompt: string,
  width = 1024,
  height = 1024,
): Promise<ImageGenResult> {
  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ prompt, width, height }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Image generation failed: ${res.status}`);
  }
  return res.json();
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function authRegister(email: string, password: string): Promise<{ access_token: string }> {
  const res = await fetch('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Registration failed: ${res.status}`);
  }
  return res.json();
}

export async function authLogin(email: string, password: string): Promise<{ access_token: string }> {
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Login failed: ${res.status}`);
  }
  return res.json();
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  status: 'todo' | 'in_progress' | 'done';
  progress: number;
  created_at: string;
  user_id: string;
}

export interface TaskSummary {
  summary: string;
  total: number;
  done: number;
  in_progress: number;
  todo: number;
}

export async function getTasks(token: string): Promise<Task[]> {
  const res = await fetch('/api/tasks', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to load tasks: ${res.status}`);
  return res.json();
}

export async function createTask(token: string, data: Partial<Task>): Promise<Task> {
  const res = await fetch('/api/tasks', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create task: ${res.status}`);
  return res.json();
}

export async function updateTask(token: string, id: string, data: Partial<Task>): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update task: ${res.status}`);
  return res.json();
}

export async function deleteTask(token: string, id: string): Promise<void> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to delete task: ${res.status}`);
}

export async function getTaskSummary(token: string): Promise<TaskSummary> {
  const res = await fetch('/api/tasks/summary', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to get summary: ${res.status}`);
  return res.json();
}

// ── Document pipeline ─────────────────────────────────────────────────────────

export interface DocumentUploadResult {
  document_id:  string;
  filename:     string;
  pages:        number;
  chunks: {
    text:          number;
    table:         number;
    image_caption: number;
    total:         number;
  };
}

export interface DocumentChunk {
  chunk_id:        string;
  document_id:     string;
  page_number:     number;
  section_heading: string;
  chunk_type:      'text' | 'table' | 'image_caption';
  content:         string;
  parent_id:       string | null;
  image_path:      string | null;
}

export async function uploadDocument(
  token: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<DocumentUploadResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documents/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 201 || xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail ?? `Upload failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

export async function getDocumentChunks(
  token: string,
  documentId: string,
): Promise<DocumentChunk[]> {
  const res = await fetch(`/api/documents/${documentId}/chunks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Failed to load chunks: ${res.status}`);
  }
  return res.json();
}

export async function deleteDocument(token: string, documentId: string): Promise<void> {
  const res = await fetch(`/api/documents/${documentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function clearImageMemories(token: string): Promise<{ deleted_images: number }> {
  const res = await fetch('/api/documents/clear-images', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Clear images failed: ${res.status}`);
  return res.json();
}

// ── Document Analysis (Phase 2.2) ─────────────────────────────────────────────

export interface TableCard { caption: string; markdown: string; page: number; }
export interface FigureCard { page: number; description: string; }
export interface AnalysisCard {
  title:       string;
  summary:     string;
  key_facts:   string[];
  tables:      TableCard[];
  figures:     FigureCard[];
  document_id: string;
}

export async function analyseDocument(
  token: string,
  query: string,
  documentId?: string,
): Promise<AnalysisCard> {
  const res = await fetch('/api/analyse', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ query, document_id: documentId ?? null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Analysis failed: ${res.status}`);
  }
  return res.json();
}

// ── Analytics (Phase 2.3) ─────────────────────────────────────────────────────

export interface DailyActivity { date: string; count: number; }
export interface AnalyticsData {
  total_memories:      number;
  memories_this_week:  number;
  total_documents:     number;
  total_doc_chunks:    number;
  table_chunks:        number;
  image_chunks:        number;
  total_tasks:         number;
  done_tasks:          number;
  pending_tasks:       number;
  total_sessions:      number;
  total_messages:      number;
  recent_activity:     DailyActivity[];
}

export async function getAnalytics(token: string): Promise<AnalyticsData> {
  const res = await fetch('/api/analytics', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Analytics failed: ${res.status}`);
  return res.json();
}

// ── Stored document summaries ─────────────────────────────────────────────────

export interface StoredDocument {
  document_id: string;
  filename:    string;
  chunk_count: number;
  table_count: number;
  image_count: number;
  text_count:  number;
  uploaded_at: string;
}

export async function listDocuments(token: string): Promise<StoredDocument[]> {
  const res = await fetch('/api/documents/summary', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to list documents: ${res.status}`);
  return res.json();
}
