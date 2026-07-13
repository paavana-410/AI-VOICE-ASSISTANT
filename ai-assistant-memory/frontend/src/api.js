/**
 * api.js — Fetch wrappers to the FastAPI backend.
 * All functions return parsed JSON or throw on error.
 */

const BASE = '/api'

async function handleResponse(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

// ── Chat ────────────────────────────────────────────────────────────────────

export async function sendChat(message, userId = 'demo_user') {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, user_id: userId }),
  })
  return handleResponse(res)
}

export async function sendCrewChat(message, userId = 'demo_user') {
  const res = await fetch(`${BASE}/crew-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, user_id: userId }),
  })
  return handleResponse(res)
}

// ── Memory Inspector ─────────────────────────────────────────────────────────

export async function listMemories(userId = 'demo_user') {
  const res = await fetch(`${BASE}/memories?user_id=${encodeURIComponent(userId)}`)
  return handleResponse(res)
}

export async function searchMemories(query, userId = 'demo_user') {
  const res = await fetch(
    `${BASE}/memories/search?q=${encodeURIComponent(query)}&user_id=${encodeURIComponent(userId)}`
  )
  return handleResponse(res)
}

export async function updateMemory(memoryId, newText, userId = 'demo_user') {
  const res = await fetch(`${BASE}/memories/${encodeURIComponent(memoryId)}?user_id=${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memory: newText }),
  })
  return handleResponse(res)
}

export async function deleteMemory(memoryId) {
  const res = await fetch(`${BASE}/memories/${encodeURIComponent(memoryId)}`, {
    method: 'DELETE',
  })
  return handleResponse(res)
}

export async function deleteAllMemories(userId = 'demo_user') {
  const res = await fetch(`${BASE}/memories?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
  return handleResponse(res)
}
