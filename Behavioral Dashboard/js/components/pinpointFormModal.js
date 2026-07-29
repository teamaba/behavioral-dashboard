/**
 * pinpointFormModal.js — Create/edit a Pinpoint Library template.
 * Single-page form (per stakeholder feedback on Precision X's multi-step
 * wizard) covering: name, optional procedure/plan, measurement type + its
 * type-specific settings, goal direction + min/max aim, default view/point
 * display, and the default legend (correct/incorrect/neutral labels).
 * After a successful create, swaps into a read-only "View Pinpoint" summary
 * with an Edit button, per stakeholder spec.
 */

const PF_VIEW_OPTIONS = [
  ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'],
  ['yearly', 'Yearly'], ['timings', 'Timings'], ['count_per_day', 'Count Per Day'],
];
const PF_DISPLAY_OPTIONS = [
  ['geometric_mean', 'Geometric Mean'], ['first', 'First'], ['last', 'Last'],
  ['stacked', 'Stacked'], ['median', 'Median'], ['summative', 'Summative'],
  ['best', 'Best'], ['worst', 'Worst'],
];

class PinpointFormModal {
  constructor() {
    this._categories = [];
    this._editingId  = null;
    this._onSaved    = null; // optional callback(pinpoint) set by callers like PinpointsLibrary
    this._render();
  }

  // presetCategoryId prefills the category select for "+ new pinpoint" from
  // inside a specific category folder.
  async show(pinpointId = null, presetCategoryId = null, onSaved = null) {
    this.overlay.classList.remove('hidden');
    this._onSaved = onSaved;
    try { this._categories = (await DB.categories.getAll()) || []; } catch (err) { console.error(err); }

    this._editingId = pinpointId;
    if (pinpointId) {
      const pp = await DB.pinpoints.get(pinpointId);
      if (!pp) { this.hide(); return; }
      this._pinpoint = pp;
      this._renderSummary(pp);
    } else {
      this._pinpoint = null;
      this._renderForm(null, presetCategoryId);
    }
  }

  hide() { this.overlay.classList.add('hidden'); }

  _render() {
    this.overlay = document.getElementById('pinpoint-form-overlay');
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.hide(); });
  }

  // ── Read-only "View Pinpoint" summary ────────────────────────────────────

  _renderSummary(pp) {
    const cat = this._categories.find(c => String(c.id) === String(pp.category_id));
    const row = (label, value) => value ? `
      <div class="pf-summary-row"><span class="pf-summary-label">${_esc(label)}</span><span class="pf-summary-val">${_esc(String(value))}</span></div>` : '';

    this.overlay.innerHTML = `
      <div class="login-card overlay-modal-card">
        <button class="invite-close" id="pf-close">&#x2715;</button>
        <div class="login-mode-label">View Pinpoint</div>
        <div class="pf-summary">
          <h3 class="pf-summary-title">${_esc(pp.name)}</h3>
          ${row('Folder', cat?.name || 'No folder')}
          ${row('Procedure / plan', pp.description)}
          ${row('Measurement type', _pfTypeLabel(pp.measurement_type))}
          ${row('Has neutral field', pp.has_neutral_field ? 'Yes' : null)}
          ${row('Default counting time', pp.default_counting_time ? _ppFormatTime(pp.default_counting_time) : null)}
          ${row('Goal direction', pp.goal_direction ? _pfCap(pp.goal_direction) : null)}
          ${row('Target range', (pp.target_min != null || pp.target_max != null)
            ? `${_pfTargetDisplay(pp, 'target_min')} to ${_pfTargetDisplay(pp, 'target_max')}` : null)}
          ${row('Default view', _pfLabelFrom(PF_VIEW_OPTIONS, pp.default_view))}
          ${row('Default point display', _pfLabelFrom(PF_DISPLAY_OPTIONS, pp.default_point_display))}
          ${row('Correct / success label', pp.correct_label)}
          ${row('Incorrect / error label', pp.incorrect_label)}
          ${row('Neutral label', pp.neutral_label)}
        </div>
        <div class="pf-summary" id="pf-usage-section">
          <div class="pf-summary-row"><span class="pf-summary-label">Created</span><span class="pf-summary-val">Loading&#8230;</span></div>
        </div>
        <div class="overlay-modal-actions">
          <button class="btn-outline" id="pf-delete">Delete pinpoint</button>
          <button class="login-btn overlay-view-btn" id="pf-edit">Edit</button>
        </div>
        <div class="login-feedback" id="pf-feedback"></div>
      </div>`;

    document.getElementById('pf-close').addEventListener('click', () => this.hide());
    document.getElementById('pf-edit').addEventListener('click', () => this._renderForm(pp));
    document.getElementById('pf-delete').addEventListener('click', () => this._deletePinpoint(pp));
    this._loadUsageInfo(pp);
  }

  // Created-by/created-at/last-used/client list — fetched separately from
  // the rest of the summary so opening View Pinpoint isn't blocked on 3
  // extra network round-trips just to show the static fields.
  async _loadUsageInfo(pp) {
    const section = document.getElementById('pf-usage-section');
    if (!section) return;
    const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    try {
      const [creator, instances] = await Promise.all([
        DB.users.getOne(pp.created_by),
        DB.participantPinpoints.getByPinpoint(pp.id),
      ]);
      const instanceIds = instances.map(i => i.id);
      const lastDate = instanceIds.length ? await DB.points.getLastDate(instanceIds) : null;
      const clientNames = instances.map(i => i.participants?.name).filter(Boolean);

      section.innerHTML = `
        <div class="pf-summary-row"><span class="pf-summary-label">Created by</span><span class="pf-summary-val">${_esc(creator?.email || 'Unknown')}</span></div>
        <div class="pf-summary-row"><span class="pf-summary-label">Created</span><span class="pf-summary-val">${fmtDate(pp.created_at)}</span></div>
        <div class="pf-summary-row"><span class="pf-summary-label">Last used</span><span class="pf-summary-val">${lastDate ? fmtDate(lastDate) : 'Never'}</span></div>
        <details class="pf-clients-details">
          <summary class="pf-summary-label">Clients using this pinpoint (${clientNames.length})</summary>
          ${clientNames.length
            ? `<ul class="pf-clients-list">${clientNames.map(n => `<li>${_esc(n)}</li>`).join('')}</ul>`
            : '<p class="pf-clients-empty">Not currently assigned to any participant.</p>'}
        </details>`;
    } catch (err) {
      section.innerHTML = `<div class="pf-summary-row"><span class="pf-summary-label">Usage info</span><span class="pf-summary-val">Could not load</span></div>`;
      console.error('[PinpointFormModal] usage info failed:', err);
    }
  }

  async _deletePinpoint(pp) {
    if (!confirm(`Delete "${pp.name}" from the library? Charts already assigned to participants are unaffected.`)) return;
    try {
      await DB.pinpoints.delete(pp.id);
      this.hide();
      this._onSaved?.(null);
    } catch (err) {
      alert('Could not delete pinpoint: ' + err.message);
    }
  }

  // ── Editable form ─────────────────────────────────────────────────────────

  _renderForm(pp, presetCategoryId) {
    const isEdit = !!pp;
    const catOptions = _pfCategoryOptionsHTML(this._categories, pp?.category_id ?? presetCategoryId ?? '');
    const mt = pp?.measurement_type || 'frequency';

    this.overlay.innerHTML = `
      <div class="login-card overlay-modal-card pf-form-card">
        <button class="invite-close" id="pf-close">&#x2715;</button>
        <div class="login-mode-label">${isEdit ? 'Edit Pinpoint' : 'New Pinpoint'}</div>

        <div class="pf-form-grid">
          <div class="field-group">
            <label for="pf-category">Folder</label>
            <select id="pf-category" class="invite-select">${catOptions}</select>
          </div>
          <div class="field-group">
            <label for="pf-name">Name</label>
            <input type="text" id="pf-name" placeholder="e.g. See open teammate / pass ball" value="${_esc(pp?.name || '')}">
          </div>
          <div class="field-group pf-form-grid-full">
            <label for="pf-description">Procedure / plan (optional)</label>
            <textarea id="pf-description" rows="2" placeholder="How is this measured — live, from video, etc.">${_esc(pp?.description || '')}</textarea>
          </div>

          <div class="field-group">
            <label for="pf-measurement-type">Measurement type</label>
            <select id="pf-measurement-type" class="invite-select" ${isEdit ? 'disabled title="Measurement type is locked after creation"' : ''}>
              <option value="frequency"     ${mt === 'frequency'     ? 'selected' : ''}>Frequency (rate)</option>
              <option value="duration"      ${mt === 'duration'      ? 'selected' : ''}>Duration</option>
              <option value="latency"       ${mt === 'latency'       ? 'selected' : ''}>Latency</option>
              <option value="count_per_day" ${mt === 'count_per_day' ? 'selected' : ''}>Count Per Day</option>
            </select>
          </div>
          <div class="field-group" id="pf-counting-time-group">
            <label for="pf-counting-time">Default counting time</label>
            <input type="text" id="pf-counting-time" placeholder="e.g. 0:60 or 60" value="${pp?.default_counting_time != null ? _ppFormatTime(pp.default_counting_time) : ''}">
          </div>
          <div class="field-group pf-checkbox-group" id="pf-neutral-field-group">
            <label><input type="checkbox" id="pf-neutral-field" ${pp?.has_neutral_field ? 'checked' : ''}> Has neutral field (e.g. prompts)</label>
          </div>

          <div class="field-group">
            <label for="pf-goal-direction">Goal direction</label>
            <select id="pf-goal-direction" class="invite-select">
              <option value="">No goal set</option>
              <option value="acceleration" ${pp?.goal_direction === 'acceleration' ? 'selected' : ''}>Acceleration (get faster / more)</option>
              <option value="deceleration" ${pp?.goal_direction === 'deceleration' ? 'selected' : ''}>Deceleration (get slower / fewer)</option>
            </select>
          </div>
          <div class="field-group">
            <label for="pf-target-min">Target min</label>
            <input type="text" id="pf-target-min" value="${_pfTargetInputValue(pp, mt, 'target_min')}">
          </div>
          <div class="field-group">
            <label for="pf-target-max">Target max</label>
            <input type="text" id="pf-target-max" value="${_pfTargetInputValue(pp, mt, 'target_max')}">
          </div>

          <div class="field-group">
            <label for="pf-default-view">Default view</label>
            <select id="pf-default-view" class="invite-select">
              ${PF_VIEW_OPTIONS.map(([v, l]) => `<option value="${v}" ${(pp?.default_view || 'daily') === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label for="pf-default-point-display">Default point display</label>
            <select id="pf-default-point-display" class="invite-select">
              ${PF_DISPLAY_OPTIONS.map(([v, l]) => `<option value="${v}" ${(pp?.default_point_display || 'geometric_mean') === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>

          <div class="field-group">
            <label for="pf-correct-label">Correct / success label</label>
            <input type="text" id="pf-correct-label" placeholder="e.g. Made shot" value="${_esc(pp?.correct_label || '')}">
          </div>
          <div class="field-group">
            <label for="pf-incorrect-label">Incorrect / error label</label>
            <input type="text" id="pf-incorrect-label" placeholder="e.g. Missed shot" value="${_esc(pp?.incorrect_label || '')}">
          </div>
          <div class="field-group" id="pf-neutral-label-group">
            <label for="pf-neutral-label">Neutral label (optional)</label>
            <input type="text" id="pf-neutral-label" placeholder="e.g. Prompted" value="${_esc(pp?.neutral_label || '')}">
          </div>
        </div>

        <div class="overlay-modal-actions">
          <button class="login-btn overlay-view-btn" id="pf-save">${isEdit ? 'Save changes' : 'Create pinpoint'}</button>
        </div>
        <div class="login-feedback" id="pf-feedback"></div>
      </div>`;

    document.getElementById('pf-close').addEventListener('click', () => this.hide());
    document.getElementById('pf-measurement-type').addEventListener('change', () => this._applyTypeMode());
    document.getElementById('pf-neutral-field').addEventListener('change', () => this._applyTypeMode());
    document.getElementById('pf-save').addEventListener('click', () => this._save(pp));
    this._applyTypeMode();
  }

  _applyTypeMode() {
    const mt = document.getElementById('pf-measurement-type').value;
    const neutralGroup = document.getElementById('pf-neutral-field-group');
    const countingGroup = document.getElementById('pf-counting-time-group');
    const neutralChecked = document.getElementById('pf-neutral-field').checked;
    const canHaveNeutral = mt === 'frequency' || mt === 'count_per_day';
    neutralGroup.style.display  = canHaveNeutral ? '' : 'none';
    countingGroup.style.display = (mt === 'frequency') ? '' : 'none';
    document.getElementById('pf-neutral-label-group').style.display = (canHaveNeutral && neutralChecked) ? '' : 'none';

    const isTime = _ppIsTimeType(mt);
    document.getElementById('pf-target-min').placeholder = isTime ? 'e.g. 0:30 or 1:00:00' : 'e.g. 1.25';
    document.getElementById('pf-target-max').placeholder = isTime ? 'e.g. 0:45 or 1:30:00' : 'e.g. 1.5';
  }

  async _save(existing) {
    const val  = id => document.getElementById(id).value.trim();
    const name = val('pf-name');
    if (!name) { this._feedback('Enter a name.', true); return; }

    const measurement_type = document.getElementById('pf-measurement-type').value;
    const isTime = _ppIsTimeType(measurement_type);
    const parseTarget = raw => {
      if (raw === '') return undefined;
      return isTime ? _ppParseTime(raw) : parseFloat(raw);
    };
    const minRaw = val('pf-target-min'), maxRaw = val('pf-target-max');
    const target_min = parseTarget(minRaw);
    const target_max = parseTarget(maxRaw);
    if ((minRaw !== '' && target_min == null) || (maxRaw !== '' && target_max == null)) {
      this._feedback(isTime ? 'Enter target min/max as a time (e.g. 0:30 or 1:00:00).' : 'Enter target min/max as a number.', true);
      return;
    }
    const countingRaw = val('pf-counting-time');
    const default_counting_time = measurement_type === 'frequency' && countingRaw !== ''
      ? _ppParseTime(countingRaw) : null;
    if (measurement_type === 'frequency' && countingRaw !== '' && default_counting_time == null) {
      this._feedback('Enter counting time as a time (e.g. 0:60 or 60).', true);
      return;
    }
    const fields = {
      category_id: document.getElementById('pf-category').value || null,
      name,
      description: val('pf-description') || null,
      measurement_type,
      has_neutral_field: (measurement_type === 'frequency' || measurement_type === 'count_per_day')
        && document.getElementById('pf-neutral-field').checked,
      default_counting_time,
      goal_direction: document.getElementById('pf-goal-direction').value || null,
      target_min: target_min ?? null,
      target_max: target_max ?? null,
      default_view: document.getElementById('pf-default-view').value,
      default_point_display: document.getElementById('pf-default-point-display').value,
      correct_label: val('pf-correct-label') || null,
      incorrect_label: val('pf-incorrect-label') || null,
      neutral_label: val('pf-neutral-label') || null,
    };

    const btn = document.getElementById('pf-save');
    btn.disabled = true;
    try {
      let saved;
      if (existing) {
        await DB.pinpoints.update(existing.id, fields);
        saved = { ...existing, ...fields };
      } else {
        saved = await DB.pinpoints.add(fields);
      }
      this._onSaved?.(saved);
      this._pinpoint = saved;
      this._renderSummary(saved);
    } catch (err) {
      this._feedback('Could not save: ' + err.message, true);
      btn.disabled = false;
    }
  }

  _feedback(msg, isError) {
    const fb = document.getElementById('pf-feedback');
    if (!fb) return;
    fb.textContent = msg;
    fb.className = 'login-feedback ' + (isError ? 'error' : 'success');
  }
}

// ── Time helpers shared with addChartModal.js (loads after this file) ──────
// duration/latency target_min/target_max are stored as raw seconds, entered
// and displayed as m:ss/h:mm:ss like every other time field in the app —
// mirrors GoalsManager._parseTime/_formatTime.
function _ppIsTimeType(mt) { return mt === 'duration' || mt === 'latency'; }

function _ppParseTime(str) {
  if (!str) return null;
  const segs = str.trim().split(':');
  if (segs.length < 1 || segs.length > 3) return null;
  const nums = segs.map((s, i) => i === segs.length - 1 ? parseFloat(s) : parseInt(s, 10));
  if (nums.some(isNaN)) return null;
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0];
}

function _ppFormatSecPart(sec) {
  const whole = Math.floor(sec);
  let str = String(whole).padStart(2, '0');
  const frac = Math.round((sec - whole) * 1000) / 1000;
  if (frac > 0) {
    let fracStr = frac.toFixed(3).slice(1).replace(/0+$/, '');
    if (fracStr !== '.') str += fracStr;
  }
  return str;
}

function _ppFormatTime(sec) {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const sStr = _ppFormatSecPart(s);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sStr}` : `${m}:${sStr}`;
}

// Duration/latency points are plotted as a rate (60/seconds) on the same
// scale as every other point, so a time-based aim target has to convert —
// shorter time = higher rate. Mirrors GoalsManager._secondsToRate.
function _ppSecondsToRate(sec) { return sec > 0 ? 60 / sec : null; }

// Prefill value for the editable target min/max text inputs — formatted as
// a time for duration/latency, plain for frequency/count_per_day.
function _pfTargetInputValue(pp, mt, key) {
  const v = pp?.[key];
  if (v == null) return '';
  return _ppIsTimeType(mt) ? _ppFormatTime(v) : v;
}
function _pfTargetDisplay(pp, key) {
  const v = pp[key];
  if (v == null) return '—';
  return _ppIsTimeType(pp.measurement_type) ? _ppFormatTime(v) : v;
}

function _pfTypeLabel(mt) {
  return { frequency: 'Frequency (rate)', duration: 'Duration', latency: 'Latency', count_per_day: 'Count Per Day' }[mt] || mt;
}
function _pfCap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function _pfLabelFrom(options, value) {
  const found = options.find(([v]) => v === value);
  return found ? found[1] : value;
}
function _pfCategoryOptionsHTML(categories, selectedId) {
  const byParent = {};
  categories.forEach(c => {
    const key = c.parent_id || '';
    (byParent[key] ||= []).push(c);
  });
  const opts = ['<option value="">No folder</option>'];
  const walk = (parentKey, depth) => {
    (byParent[parentKey] || []).slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => {
      const prefix = depth > 0 ? '— '.repeat(depth) : '';
      opts.push(`<option value="${c.id}"${String(c.id) === String(selectedId) ? ' selected' : ''}>${prefix}${_esc(c.name)}</option>`);
      walk(c.id, depth + 1);
    });
  };
  walk('', 0);
  return opts.join('');
}
