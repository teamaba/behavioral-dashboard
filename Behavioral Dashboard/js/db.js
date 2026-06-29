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
    let res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      headers: { ...authHeaders(), ...(options.headers || {}) },
      ...options
    });
    if (res.status === 401) {
      const refreshed = await restoreSession();
      if (refreshed) {
        res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
          headers: { ...authHeaders(), ...(options.headers || {}) },
          ...options
        });
      }
    }
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
    const redirectTo = window.location.href.split('#')[0];
    return authRequest(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email });
  }

  async function updatePassword(token, newPassword) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ password: newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || data.error || 'Failed to update password');
    return data;
  }

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

  function getProfile()   { return currentProfile; }
  function isStaff()      { return currentProfile?.role === 'staff' || currentProfile?.role === 'supervisor'; }
  function isSupervisor() { return currentProfile?.role === 'supervisor'; }
  function isClient()     { return currentProfile?.role === 'client'; }
  function isLoggedIn()   { return !!currentUser; }

  // ── Teams ──────────────────────────────────────────────────────────────

  async function getTeams() {
    return restRequest('/teams?order=name.asc');
  }

  async function addTeam(name) {
    const rows = await restRequest('/teams', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    return rows[0];
  }

  async function seedDemoHierarchy() {
    const [magicRows, kingsRows] = await Promise.all([
      restRequest('/teams', { method: 'POST', body: JSON.stringify({ name: 'Orlando Magic' }) }),
      restRequest('/teams', { method: 'POST', body: JSON.stringify({ name: 'Sacramento Kings' }) }),
    ]);
    const magic = magicRows[0];
    const kings = kingsRows[0];

    const [banchero, wagner, suggs, murray, sabonis] = await Promise.all([
      restRequest('/participants', { method: 'POST', body: JSON.stringify({ team_id: magic.id, name: 'Paolo Banchero' }) }),
      restRequest('/participants', { method: 'POST', body: JSON.stringify({ team_id: magic.id, name: 'Franz Wagner' }) }),
      restRequest('/participants', { method: 'POST', body: JSON.stringify({ team_id: magic.id, name: 'Jalen Suggs' }) }),
      restRequest('/participants', { method: 'POST', body: JSON.stringify({ team_id: kings.id, name: 'Keegan Murray' }) }),
      restRequest('/participants', { method: 'POST', body: JSON.stringify({ team_id: kings.id, name: 'Domantas Sabonis' }) }),
    ]);

    await Promise.all([
      restRequest('/behaviors', { method: 'POST', body: JSON.stringify({ participant_id: banchero[0].id, name: 'Ball Handling',     created_by: currentUser?.id }) }),
      restRequest('/behaviors', { method: 'POST', body: JSON.stringify({ participant_id: banchero[0].id, name: 'Post Moves',        created_by: currentUser?.id }) }),
      restRequest('/behaviors', { method: 'POST', body: JSON.stringify({ participant_id: wagner[0].id,   name: 'Drive and Kick',    created_by: currentUser?.id }) }),
      restRequest('/behaviors', { method: 'POST', body: JSON.stringify({ participant_id: suggs[0].id,    name: 'Press Defense',     created_by: currentUser?.id }) }),
      restRequest('/behaviors', { method: 'POST', body: JSON.stringify({ participant_id: murray[0].id,   name: 'Corner Three',      created_by: currentUser?.id }) }),
      restRequest('/behaviors', { method: 'POST', body: JSON.stringify({ participant_id: murray[0].id,   name: 'Off-Ball Movement', created_by: currentUser?.id }) }),
      restRequest('/behaviors', { method: 'POST', body: JSON.stringify({ participant_id: sabonis[0].id,  name: 'Pick and Roll',     created_by: currentUser?.id }) }),
    ]);
  }

  // ── Participants ───────────────────────────────────────────────────────

  async function getParticipants() {
    return restRequest('/participants?order=name.asc');
  }

  async function addParticipant(teamId, name, email) {
    const rows = await restRequest('/participants', {
      method: 'POST',
      body: JSON.stringify({ team_id: teamId, name, email: email || null })
    });
    return rows[0];
  }

  async function getSelfParticipant() {
    if (!currentUser?.email) return null;
    const rows = await restRequest(
      `/participants?email=eq.${encodeURIComponent(currentUser.email)}&select=*,teams(name)&limit=1`
    );
    return rows && rows.length ? rows[0] : null;
  }

  async function updateParticipant(id, fields) {
    return restRequest(`/participants?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields)
    });
  }

  // ── Behaviors ──────────────────────────────────────────────────────────

  async function getBehaviors(participantId) {
    return restRequest(`/behaviors?participant_id=eq.${participantId}&order=created_at.asc`);
  }

  async function getAllBehaviors() {
    return restRequest('/behaviors?order=participant_id.asc,created_at.asc');
  }

  async function addBehavior(participantId, name) {
    const rows = await restRequest('/behaviors', {
      method: 'POST',
      body: JSON.stringify({ participant_id: participantId, name, created_by: currentUser?.id })
    });
    return rows[0];
  }

  async function deleteBehavior(id) {
    return restRequest(`/behaviors?id=eq.${id}`, { method: 'DELETE' });
  }

  // ── Domains ────────────────────────────────────────────────────────────

  async function getDomains() {
    return restRequest('/domains?order=name.asc');
  }

  // ── Data points ────────────────────────────────────────────────────────

  async function getPoints(behaviorId, domainId) {
    return restRequest(
      `/data_points?behavior_id=eq.${behaviorId}&domain_id=eq.${domainId}&order=day.asc,created_at.asc`
    );
  }

  async function addPoint({ behavior_id, domain_id, type, day, val, note, floor }) {
    const body = { behavior_id, domain_id, type, day, val: val ?? null, note: note || '' };
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

  async function clearPoints(behaviorId, domainId) {
    return restRequest(
      `/data_points?behavior_id=eq.${behaviorId}&domain_id=eq.${domainId}`,
      { method: 'DELETE' }
    );
  }

  // ── Chart metadata ─────────────────────────────────────────────────────

  async function getMeta(behaviorId, domainId) {
    const rows = await restRequest(
      `/chart_meta?behavior_id=eq.${behaviorId}&domain_id=eq.${domainId}&limit=1`
    );
    return rows && rows.length ? rows[0] : null;
  }

  async function upsertMeta(behaviorId, domainId, fields) {
    const existing = await getMeta(behaviorId, domainId);
    if (existing) {
      return restRequest(`/chart_meta?id=eq.${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
      });
    } else {
      return restRequest('/chart_meta', {
        method: 'POST',
        body: JSON.stringify({ behavior_id: behaviorId, domain_id: domainId, ...fields })
      });
    }
  }

  // ── Client goals ───────────────────────────────────────────────────────

  async function getGoals(behaviorId, domainId) {
    return restRequest(
      `/goals?behavior_id=eq.${behaviorId}&domain_id=eq.${domainId}&achieved=eq.false&order=created_at.asc`
    );
  }

  async function addGoal(behaviorId, domainId, { type, target, note }) {
    const rows = await restRequest('/goals', {
      method: 'POST',
      body: JSON.stringify({ behavior_id: behaviorId, domain_id: domainId, type, target, note: note || null, created_by: currentUser?.id })
    });
    return rows[0];
  }

  async function deleteGoal(id) {
    return restRequest(`/goals?id=eq.${id}`, { method: 'DELETE' });
  }

  async function markGoalAchieved(id) {
    return restRequest(`/goals?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ achieved: true, notified_at: new Date().toISOString() })
    });
  }

  // ── Notification emails ────────────────────────────────────────────────

  async function getNotificationEmails(participantId) {
    return restRequest(
      `/notification_emails?participant_id=eq.${participantId}&order=created_at.asc`
    );
  }

  async function getAllNotificationEmails() {
    return restRequest('/notification_emails?order=participant_id.asc,created_at.asc');
  }

  async function addNotificationEmail(participantId, email, label) {
    const rows = await restRequest('/notification_emails', {
      method: 'POST',
      body: JSON.stringify({ participant_id: participantId, email, label: label || null, created_by: currentUser?.id })
    });
    return rows[0];
  }

  async function deleteNotificationEmail(id) {
    return restRequest(`/notification_emails?id=eq.${id}`, { method: 'DELETE' });
  }

  // ── Edge Functions ─────────────────────────────────────────────────────

  async function invokeFunction(name, body) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${accessToken || SUPABASE_KEY}`
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Function error (${res.status}): ${err}`);
    }
    return res.json();
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
      requestPasswordReset, updatePassword,
      getProfile, isStaff, isSupervisor, isClient, isLoggedIn
    },
    teams:         { getAll: getTeams, add: addTeam, seedDemo: seedDemoHierarchy },
    participants:  { getAll: getParticipants, getSelf: getSelfParticipant, add: addParticipant, update: updateParticipant },
    notifications: { getAll: getAllNotificationEmails, getForParticipant: getNotificationEmails, add: addNotificationEmail, delete: deleteNotificationEmail },
    behaviors:    { get: getBehaviors, getAll: getAllBehaviors, add: addBehavior, delete: deleteBehavior },
    domains:      { getAll: getDomains },
    points:       { get: getPoints, add: addPoint, delete: deletePoint, clear: clearPoints },
    meta:         { get: getMeta, upsert: upsertMeta },
    goals:        { get: getGoals, add: addGoal, delete: deleteGoal, markAchieved: markGoalAchieved },
    functions:    { invoke: invokeFunction },
    invites:      { add: addAllowed },
    users:        { getAll: getAllProfiles, update: updateUserProfile, remove: removeUser }
  };
})();
