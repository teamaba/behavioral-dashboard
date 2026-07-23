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
    const redirectTo = 'https://teamaba.github.io/behavioral-dashboard/Behavioral%20Dashboard/';
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
  function isGuide()      { return currentProfile?.role === 'guide'; }
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

  // Builds a small demo hierarchy exercising all 4 measurement types, so
  // every pinpoint code path (frequency/duration/latency/count_per_day) has
  // sample data to click through without hand-creating it first.
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

    const categories = await getCategories();
    const catBySlug = {};
    categories.forEach(c => { if (c.slug) catBySlug[c.slug] = c; });

    const [ballHandling, postMoveHold, doubleTeamReact, composureResets] = await Promise.all([
      addPinpoint({
        category_id: catBySlug.movement?.id || null, name: 'Ball Handling Reps',
        description: 'Cone weave dribbling drill, count clean reps per timed set.',
        measurement_type: 'frequency', has_neutral_field: false, include_record_ceiling: false,
        default_counting_time: 60, goal_direction: 'acceleration',
        correct_label: 'Clean rep', incorrect_label: 'Lost ball',
        default_view: 'daily', default_point_display: 'geometric_mean',
      }),
      addPinpoint({
        category_id: catBySlug.physical?.id || null, name: 'Post Move Hold',
        description: 'Time how long a post-up seal is held under contact.',
        measurement_type: 'duration', include_record_ceiling: false,
        goal_direction: 'acceleration',
        correct_label: 'Held seal', incorrect_label: '',
        default_view: 'daily', default_point_display: 'geometric_mean',
      }),
      addPinpoint({
        category_id: catBySlug.decision?.id || null, name: 'React to Double Team',
        description: 'Time from double-team arrival to outlet pass release.',
        measurement_type: 'latency', include_record_ceiling: false,
        goal_direction: 'deceleration',
        correct_label: 'Pass released', incorrect_label: '',
        default_view: 'daily', default_point_display: 'geometric_mean',
      }),
      addPinpoint({
        category_id: catBySlug.emotional?.id || null, name: 'Composure Resets',
        description: 'Count of visible reset routines used after a bad-call or turnover.',
        measurement_type: 'count_per_day', has_neutral_field: false, include_record_ceiling: false,
        goal_direction: 'acceleration',
        correct_label: 'Reset used', incorrect_label: '',
        default_view: 'count_per_day', default_point_display: 'summative',
      }),
    ]);

    await Promise.all([
      addParticipantPinpoint(banchero[0].id, ballHandling),
      addParticipantPinpoint(banchero[0].id, postMoveHold),
      addParticipantPinpoint(wagner[0].id,   doubleTeamReact),
      addParticipantPinpoint(suggs[0].id,    composureResets),
      addParticipantPinpoint(murray[0].id,   ballHandling),
      addParticipantPinpoint(sabonis[0].id,  postMoveHold),
    ]);
  }

  // ── Participants ───────────────────────────────────────────────────────

  async function getParticipants() {
    return restRequest('/participants?order=name.asc');
  }

  async function addParticipant(teamId, name, email, age, gender) {
    const rows = await restRequest('/participants', {
      method: 'POST',
      body: JSON.stringify({
        team_id: teamId, name, email: email || null,
        age: age || null, gender: gender || null
      })
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

  // ── Guides (read-only, multi-participant role) ──────────────────────────

  async function getAllGuides() {
    return restRequest('/profiles?role=eq.guide&order=email.asc');
  }

  async function getAllGuideAssignments() {
    return restRequest('/guide_participants?select=guide_user_id,participant_id,profiles(email)');
  }

  async function assignGuide(participantId, guideUserId) {
    const rows = await restRequest('/guide_participants', {
      method: 'POST',
      body: JSON.stringify({ guide_user_id: guideUserId, participant_id: participantId })
    });
    return rows[0];
  }

  async function unassignGuide(participantId, guideUserId) {
    return restRequest(
      `/guide_participants?participant_id=eq.${participantId}&guide_user_id=eq.${guideUserId}`,
      { method: 'DELETE' }
    );
  }

  // ── Categories (open-ended, nestable — replaces the old fixed "domains") ─

  async function getCategories() {
    return restRequest('/categories?order=name.asc');
  }

  async function addCategory(name, parentId) {
    const rows = await restRequest('/categories', {
      method: 'POST',
      body: JSON.stringify({ name, parent_id: parentId || null, created_by: currentUser?.id })
    });
    return rows[0];
  }

  async function updateCategory(id, fields) {
    return restRequest(`/categories?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields)
    });
  }

  async function deleteCategory(id) {
    return restRequest(`/categories?id=eq.${id}`, { method: 'DELETE' });
  }

  // ── Pinpoints (reusable library templates, live inside a category) ──────

  async function getPinpoints() {
    return restRequest('/pinpoints?order=name.asc');
  }

  async function getPinpointsByCategory(categoryId) {
    return restRequest(`/pinpoints?category_id=eq.${categoryId}&order=name.asc`);
  }

  async function getPinpoint(id) {
    const rows = await restRequest(`/pinpoints?id=eq.${id}&limit=1`);
    return rows && rows.length ? rows[0] : null;
  }

  async function addPinpoint(fields) {
    const rows = await restRequest('/pinpoints', {
      method: 'POST',
      body: JSON.stringify({ ...fields, created_by: currentUser?.id })
    });
    return rows[0];
  }

  async function updatePinpoint(id, fields) {
    return restRequest(`/pinpoints?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
    });
  }

  async function deletePinpoint(id) {
    return restRequest(`/pinpoints?id=eq.${id}`, { method: 'DELETE' });
  }

  // ── Participant Pinpoints (per-athlete chart instance) ───────────────────
  // Copied from a library Pinpoint at creation time — editing the library
  // template afterward never touches existing instances.

  async function getParticipantPinpoints(participantId) {
    return restRequest(`/participant_pinpoints?participant_id=eq.${participantId}&order=created_at.asc`);
  }

  async function getAllParticipantPinpoints() {
    return restRequest('/participant_pinpoints?order=participant_id.asc,created_at.asc');
  }

  async function getOneParticipantPinpoint(id) {
    const rows = await restRequest(`/participant_pinpoints?id=eq.${id}&limit=1`);
    return rows && rows.length ? rows[0] : null;
  }

  // Pass either a pinpoint template object (its fields get copied) plus a
  // participantId, or a fully-formed fields object with participant_id
  // already set (for direct instance creation without a template).
  async function addParticipantPinpoint(participantId, pinpointOrFields) {
    const copyKeys = [
      'name', 'description', 'measurement_type', 'has_neutral_field', 'include_record_ceiling',
      'default_counting_time', 'goal_direction', 'target_min', 'target_max',
      'correct_label', 'incorrect_label', 'neutral_label'
    ];
    const body = { participant_id: participantId, created_by: currentUser?.id };
    if (pinpointOrFields?.id) body.pinpoint_id = pinpointOrFields.id;
    copyKeys.forEach(k => { if (pinpointOrFields?.[k] !== undefined) body[k] = pinpointOrFields[k]; });
    body.view          = pinpointOrFields?.default_view          || pinpointOrFields?.view          || 'daily';
    body.point_display  = pinpointOrFields?.default_point_display || pinpointOrFields?.point_display  || 'geometric_mean';

    const rows = await restRequest('/participant_pinpoints', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return rows[0];
  }

  async function updateParticipantPinpoint(id, fields) {
    return restRequest(`/participant_pinpoints?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields)
    });
  }

  async function deleteParticipantPinpoint(id) {
    return restRequest(`/participant_pinpoints?id=eq.${id}`, { method: 'DELETE' });
  }

  // ── Data points ────────────────────────────────────────────────────────

  async function getPoints(instanceId) {
    return restRequest(
      `/data_points?instance_id=eq.${instanceId}&order=day.asc,created_at.asc`
    );
  }

  async function addPoint({ instance_id, type, day, val, note, floor }) {
    const body = { instance_id, type, day, val: val ?? null, note: note || '' };
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

  async function clearPoints(instanceId) {
    return restRequest(`/data_points?instance_id=eq.${instanceId}`, { method: 'DELETE' });
  }

  // ── Chart metadata ─────────────────────────────────────────────────────

  async function getMeta(instanceId) {
    const rows = await restRequest(`/chart_meta?instance_id=eq.${instanceId}&limit=1`);
    return rows && rows.length ? rows[0] : null;
  }

  async function upsertMeta(instanceId, fields) {
    const existing = await getMeta(instanceId);
    if (existing) {
      return restRequest(`/chart_meta?id=eq.${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
      });
    } else {
      return restRequest('/chart_meta', {
        method: 'POST',
        body: JSON.stringify({ instance_id: instanceId, ...fields })
      });
    }
  }

  // ── Client goals ───────────────────────────────────────────────────────

  async function getGoals(instanceId) {
    return restRequest(
      `/goals?instance_id=eq.${instanceId}&achieved=eq.false&order=created_at.asc`
    );
  }

  async function addGoal(instanceId, { type, target, note }) {
    const rows = await restRequest('/goals', {
      method: 'POST',
      body: JSON.stringify({ instance_id: instanceId, type, target, note: note || null, created_by: currentUser?.id })
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
      getProfile, isStaff, isSupervisor, isClient, isGuide, isLoggedIn
    },
    teams:              { getAll: getTeams, add: addTeam, seedDemo: seedDemoHierarchy },
    participants:       { getAll: getParticipants, getSelf: getSelfParticipant, add: addParticipant, update: updateParticipant },
    guides:             { getAll: getAllGuides, getAllAssignments: getAllGuideAssignments, assign: assignGuide, unassign: unassignGuide },
    notifications:      { getAll: getAllNotificationEmails, getForParticipant: getNotificationEmails, add: addNotificationEmail, delete: deleteNotificationEmail },
    categories:         { getAll: getCategories, add: addCategory, update: updateCategory, delete: deleteCategory },
    pinpoints:          { getAll: getPinpoints, getByCategory: getPinpointsByCategory, get: getPinpoint, add: addPinpoint, update: updatePinpoint, delete: deletePinpoint },
    participantPinpoints: {
      getAll: getAllParticipantPinpoints, get: getParticipantPinpoints, getOne: getOneParticipantPinpoint,
      add: addParticipantPinpoint, update: updateParticipantPinpoint, delete: deleteParticipantPinpoint
    },
    points:             { get: getPoints, add: addPoint, delete: deletePoint, clear: clearPoints },
    meta:               { get: getMeta, upsert: upsertMeta },
    goals:              { get: getGoals, add: addGoal, delete: deleteGoal, markAchieved: markGoalAchieved },
    functions:          { invoke: invokeFunction },
    invites:            { add: addAllowed },
    users:              { getAll: getAllProfiles, update: updateUserProfile, remove: removeUser }
  };
})();
