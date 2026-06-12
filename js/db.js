/**
 * db.js — Data access layer
 *
 * All database calls go through this file only.
 * To swap backends later: rewrite this file, touch nothing else.
 *
 * Current backend: Supabase
 */

const DB = (() => {
  const SUPABASE_URL = 'https://igkuupathasyzcdybbjf.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlna3V1cGF0aGFzeXpjZHliYmpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTIyNTUsImV4cCI6MjA5Njg2ODI1NX0.Nn3tp5LveMogrMxBqQMUG--bP8pRkKnUHFvTxxbtYCc';

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation'
  };

  async function request(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      headers: { ...headers, ...(options.headers || {}) },
      ...options
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`DB error (${res.status}): ${err}`);
    }
    // 204 No Content returns no body
    if (res.status === 204) return null;
    return res.json();
  }

  // ── Data points ──────────────────────────────────────────────────────────

  async function getPoints(domainSlug) {
    return request(`/data_points?domain_slug=eq.${domainSlug}&order=day.asc,created_at.asc`);
  }

  async function addPoint({ domain_slug, type, day, val, note }) {
    const rows = await request('/data_points', {
      method: 'POST',
      body: JSON.stringify({ domain_slug, type, day, val: val ?? null, note: note || '' })
    });
    return rows[0];
  }

  async function deletePoint(id) {
    return request(`/data_points?id=eq.${id}`, { method: 'DELETE' });
  }

  async function clearPoints(domainSlug) {
    return request(`/data_points?domain_slug=eq.${domainSlug}`, { method: 'DELETE' });
  }

  // ── Chart metadata ───────────────────────────────────────────────────────

  async function getMeta(domainSlug) {
    const rows = await request(`/chart_meta?domain_slug=eq.${domainSlug}&limit=1`);
    return rows && rows.length ? rows[0] : null;
  }

  async function upsertMeta(domainSlug, fields) {
    // Check if a row exists first
    const existing = await getMeta(domainSlug);
    if (existing) {
      return request(`/chart_meta?id=eq.${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
      });
    } else {
      return request('/chart_meta', {
        method: 'POST',
        body: JSON.stringify({ domain_slug: domainSlug, ...fields })
      });
    }
  }

  // ── Public interface ─────────────────────────────────────────────────────
  // This is the only surface area the rest of the app uses.
  // Swap backends by replacing the implementations above.

  return {
    points: { get: getPoints, add: addPoint, delete: deletePoint, clear: clearPoints },
    meta:   { get: getMeta, upsert: upsertMeta }
  };
})();
