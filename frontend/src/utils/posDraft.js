const memory = new Map();
export function draftKey(userId, context = 'new') { return `pos:draft:${userId}:${context}`; }
export function readDraft(key, storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    if (value?.version === 1 && Array.isArray(value.lines)) { memory.set(key, value); return value; }
  } catch { /* Memory still preserves route navigation when storage is unavailable. */ }
  return memory.get(key) || null;
}
export function writeDraft(key, draft, storage = globalThis.sessionStorage) {
  const value = { ...draft, version: 1 };
  memory.set(key, value);
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function clearDraft(key, storage = globalThis.sessionStorage) {
  memory.delete(key);
  try { storage.removeItem(key); } catch { /* Storage can be disabled. */ }
}
