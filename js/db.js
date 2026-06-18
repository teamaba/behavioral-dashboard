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

  // ── Session state ──────────────────────────────────────────────────────
  // accessToken changes after login; anon key is the fallback for
  // unauthenticated requests (currently nothing should succeed unauthenticated
  // once RLS is locked down, but we keep this so the layer degrades gracefully).
  let accessToken = null;
  let currentUser = null;   // { id, email }
  let currentProfile = null; // { id, email, role, client_name }

  function authHeaders() {
    const token = accessToken || SUPABASE_KEY;
    return {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token}`,
      'Prefer': 'return=representation'
    };
  }

  async function restRequest(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      headers: { ...authHeaders(), ...(options.headers || {}) },
      ...options
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`DB error (${res.status}): ${err}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function authRequest(path, body) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || data.error || 'Authentication error');
    }
    return data;
  }

  // ── Auth ───────────────────────────────────────────────────────────────

  async function signUp(email, password) {
    // Will fail server-side (via the handle_new_user trigger) if the
    // email isn't on the allowed_emails list.
    const data = await authRequest('/signup', { email, password });
    if (data.access_token) {
      accessToken = data.access_token;
      currentUser = data.user;
      await _loadProfile();
    }
    return data;
  }

  async function signIn(email, password) {
    const data = await authRequest('/token?grant_type=password', { email, password });
    accessToken = data.access_token;
    currentUser = data.user;
    localStorage.setItem('sb_refresh_token', data.refresh_token);
    await _loadProfile();
    return currentProfile;
  }

  async function signOut() {
    accessToken = null;
    currentUser = null;
    currentProfile = null;
    localStorage.removeItem('sb_refresh_token');
  }

  async function requestPasswordReset(email) {
    return authRequest('/recover', { email });
  }

  // Restore session from a stored refresh token (so you're not logged out
  // every time you reload the page)
  async function restoreSession() {
    const refreshToken = localStorage.getItem('sb_refresh_token');
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      const data = await res.json();
      if (!res.ok) { localStorage.removeItem('sb_refresh_token'); return null; }
      accessToken = data.access_token;
      currentUser = data.user;
      localStorage.setItem('sb_refresh_token', data.refresh_token);
      await _loadProfile();
      return currentProfile;
    } catch {
      return null;
    }
  }

  async function _loadProfile() {
    if (!currentUser) { currentProfile = null; return; }
    const rows = await restRequest(`/profiles?id=eq.${currentUser.id}&limit=1`);
    currentProfile = rows && rows.length ? rows[0] : null;
  }

  function getProfile()    { return currentProfile; }
  function isStaff()       { return currentProfile?.role === 'staff' || currentProfile?.role === 'supervisor'; }
  function isSupervisor()  { return currentProfile?.role === 'supervisor'; }
  function isClient()      { return currentProfile?.role === 'client'; }
  function isLoggedIn()    { return !!currentUser; }

  // ── Data points ────────────────────────────────────────────────────────

  async function getPoints(domainSlug) {
    return restRequest(`/data_points?domain_slug=eq.${domainSlug}&order=day.asc,created_at.asc`);
  }

  async function addPoint({ domain_slug, type, day, val, note, floor }) {
    const body = { domain_slug, type, day, val: val ?? null, note: note || '' };
    if (floor != null) body.floor = floor;
    const rows = await restRequest('/data_points', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return rows[0];
  }

  async function deletePoint(id) {
    return restRequest(`/data_points?id=eq.${id}`, { method: 'DELETE' });
  }

  async function clearPoints(domainSlug) {
    return restRequest(`/data_points?domain_slug=eq.${domainSlug}`, { method: 'DELETE' });
  }

  // ── Chart metadata ─────────────────────────────────────────────────────

  async function getMeta(domainSlug) {
    const rows = await restRequest(`/chart_meta?domain_slug=eq.${domainSlug}&limit=1`);
    return rows && rows.length ? rows[0] : null;
  }

  async function upsertMeta(domainSlug, fields) {
    const existing = await getMeta(domainSlug);
    if (existing) {
      return restRequest(`/chart_meta?id=eq.${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
      });
    } else {
      return restRequest('/chart_meta', {
        method: 'POST',
        body: JSON.stringify({ domain_slug: domainSlug, ...fields })
      });
    }
  }

  // ── Invites ────────────────────────────────────────────────────────────

  async function addAllowed(email, role, clientName) {
    return restRequest('/rpc/add_allowed_email', {
      method: 'POST',
      body: JSON.stringify({ p_email: email, p_role: role, p_client_name: clientName || null })
    });
  }

  // ── User management ────────────────────────────────────────────────────

  async function getAllProfiles() {
    return restRequest('/profiles?order=email.asc');
  }

  async function updateUserProfile(id, fields) {
    return restRequest(`/profiles?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields)
    });
  }

  async function removeUser(id, email) {
    return restRequest('/rpc/remove_user', {
      method: 'POST',
      body: JSON.stringify({ p_id: id, p_email: email })
    });
  }

  // ── Public interface ───────────────────────────────────────────────────

  return {
    auth: {
      signUp, signIn, signOut, restoreSession,
      requestPasswordReset,
      getProfile, isStaff, isSupervisor, isClient, isLoggedIn
    },
    points:  { get: getPoints, add: addPoint, delete: deletePoint, clear: clearPoints },
    meta:    { get: getMeta, upsert: upsertMeta },
    invites: { add: addAllowed },
    users:   { getAll: getAllProfiles, update: updateUserProfile, remove: removeUser }
  };
})();
