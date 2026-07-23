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
          ${row('Category', cat?.name || 'Uncategorized')}
          ${row('Procedure / plan', pp.description)}
          ${row('Measurement type', _pfTypeLabel(pp.measurement_type))}
          ${row('Has neutral field', pp.has_neutral_field ? 'Yes' : null)}
          ${row('Default counting time', pp.default_counting_time ? pp.default_counting_time + ' sec' : null)}
          ${row('Goal direction', pp.goal_direction ? _pfCap(pp.goal_direction) : null)}
          ${row('Target range', (pp.target_min != null || pp.target_max != null) ? `${pp.target_min ?? '—'} to ${pp.target_max ?? '—'}` : null)}
          ${row('Default view', _pfLabelFrom(PF_VIEW_OPTIONS, pp.default_view))}
          ${row('Default point display', _pfLabelFrom(PF_DISPLAY_OPTIONS, pp.default_point_display))}
          ${row('Correct / success label', pp.correct_label)}
          ${row('Incorrect / error label', pp.incorrect_label)}
          ${row('Neutral label', pp.neutral_label)}
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
  }

  async _deletePinpoint(pp) {
    if (!confirm(`Delete "${pp.name}" from the library? Charts already assigned to athletes are unaffected.`)) return;
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
            <label for="pf-category">Category</label>
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
            <label for="pf-counting-time">Default counting time (sec)</label>
            <input type="number" id="pf-counting-time" min="1" step="1" placeholder="e.g. 60" value="${pp?.default_counting_time ?? ''}">
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
            <input type="number" id="pf-target-min" step="any" value="${pp?.target_min ?? ''}">
          </div>
          <div class="field-group">
            <label for="pf-target-max">Target max</label>
            <input type="number" id="pf-target-max" step="any" value="${pp?.target_max ?? ''}">
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
          <div class="field-group">
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
    document.getElementById('pf-save').addEventListener('click', () => this._save(pp));
    this._applyTypeMode();
  }

  _applyTypeMode() {
    const mt = document.getElementById('pf-measurement-type').value;
    const neutralGroup = document.getElementById('pf-neutral-field-group');
    const countingGroup = document.getElementById('pf-counting-time-group');
    neutralGroup.style.display  = (mt === 'frequency' || mt === 'count_per_day') ? '' : 'none';
    countingGroup.style.display = (mt === 'frequency') ? '' : 'none';
  }

  async _save(existing) {
    const val  = id => document.getElementById(id).value.trim();
    const name = val('pf-name');
    if (!name) { this._feedback('Enter a name.', true); return; }

    const measurement_type = document.getElementById('pf-measurement-type').value;
    const fields = {
      category_id: document.getElementById('pf-category').value || null,
      name,
      description: val('pf-description') || null,
      measurement_type,
      has_neutral_field: (measurement_type === 'frequency' || measurement_type === 'count_per_day')
        && document.getElementById('pf-neutral-field').checked,
      default_counting_time: measurement_type === 'frequency' && val('pf-counting-time')
        ? parseInt(val('pf-counting-time'), 10) : null,
      goal_direction: document.getElementById('pf-goal-direction').value || null,
      target_min: val('pf-target-min') !== '' ? parseFloat(val('pf-target-min')) : null,
      target_max: val('pf-target-max') !== '' ? parseFloat(val('pf-target-max')) : null,
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
  const opts = ['<option value="">Uncategorized</option>'];
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
