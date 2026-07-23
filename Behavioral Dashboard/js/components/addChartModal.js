/**
 * addChartModal.js — Assign a Pinpoint Library template to an athlete.
 * Pick a pinpoint (category → pinpoint cascade), review/edit every field
 * inherited from the template, then create the athlete's own independent
 * chart instance (copy-on-instantiate — editing the library template later
 * never touches instances already created from it).
 */

class AddChartModal {
  constructor() {
    this._categories = [];
    this._pinpoints   = [];
    this._participant = null; // { id, name }
    this._teamName     = '';
    this._render();
  }

  async show(participant, teamName) {
    this._participant = participant;
    this._teamName = teamName || '';
    this.overlay.classList.remove('hidden');
    try {
      const [categories, pinpoints] = await Promise.all([DB.categories.getAll(), DB.pinpoints.getAll()]);
      this._categories = categories || [];
      this._pinpoints   = pinpoints || [];
    } catch (err) { console.error('[AddChartModal]', err); }
    this._renderPicker();
  }

  hide() { this.overlay.classList.add('hidden'); }

  _render() {
    this.overlay = document.getElementById('add-chart-modal-overlay');
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.hide(); });
  }

  _renderPicker() {
    this.overlay.innerHTML = `
      <div class="login-card overlay-modal-card pf-form-card">
        <button class="invite-close" id="ac-close">&#x2715;</button>
        <div class="login-mode-label">Add Chart — ${_esc(this._participant?.name || '')}</div>

        <div class="overlay-primary-section">
          <label class="manage-section-label">Category</label>
          <select id="ac-category" class="invite-select">${_acCategoryOptionsHTML(this._categories, '')}</select>
          <label class="manage-section-label" style="margin-top:10px">Pinpoint</label>
          <select id="ac-pinpoint" class="invite-select">${this._pinpointOptionsHTML('', '')}</select>
        </div>

        <div id="ac-fields"></div>

        <div class="overlay-modal-actions">
          <button class="login-btn overlay-view-btn" id="ac-continue" disabled>Choose a pinpoint</button>
        </div>
        <div class="login-feedback" id="ac-feedback"></div>
      </div>`;

    document.getElementById('ac-close').addEventListener('click', () => this.hide());
    const catSel = document.getElementById('ac-category');
    const ppSel  = document.getElementById('ac-pinpoint');
    catSel.addEventListener('change', () => {
      ppSel.innerHTML = this._pinpointOptionsHTML(catSel.value, '');
      this._onPinpointChange();
    });
    ppSel.addEventListener('change', () => this._onPinpointChange());
  }

  _pinpointOptionsHTML(categoryId, selectedId) {
    const opts = ['<option value="">Choose a pinpoint…</option>'];
    this._pinpoints
      .filter(p => !categoryId || String(p.category_id) === String(categoryId))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(p => opts.push(`<option value="${p.id}"${String(p.id) === String(selectedId) ? ' selected' : ''}>${_esc(p.name)}</option>`));
    return opts.join('');
  }

  _onPinpointChange() {
    const id = document.getElementById('ac-pinpoint').value;
    const pp = this._pinpoints.find(p => String(p.id) === String(id));
    const fieldsEl = document.getElementById('ac-fields');
    const btn = document.getElementById('ac-continue');
    btn.removeEventListener('click', this._onContinue);

    if (!pp) {
      fieldsEl.innerHTML = '';
      btn.disabled = true;
      btn.textContent = 'Choose a pinpoint';
      return;
    }

    fieldsEl.innerHTML = this._editableFieldsHTML(pp);
    document.getElementById('ac-measurement-type').addEventListener('change', () => this._applyTypeMode());
    this._applyTypeMode();

    btn.disabled = false;
    btn.textContent = `Add to ${this._participant?.name || 'athlete'}`;
    this._onContinue = () => this._create(pp);
    btn.addEventListener('click', this._onContinue);
  }

  _editableFieldsHTML(pp) {
    const mt = pp.measurement_type;
    return `
      <div class="pf-form-grid">
        <div class="field-group">
          <label for="ac-name">Name</label>
          <input type="text" id="ac-name" value="${_esc(pp.name)}">
        </div>
        <div class="field-group pf-form-grid-full">
          <label for="ac-description">Procedure / plan</label>
          <textarea id="ac-description" rows="2">${_esc(pp.description || '')}</textarea>
        </div>

        <div class="field-group">
          <label for="ac-measurement-type">Measurement type</label>
          <select id="ac-measurement-type" class="invite-select">
            <option value="frequency"     ${mt === 'frequency'     ? 'selected' : ''}>Frequency (rate)</option>
            <option value="duration"      ${mt === 'duration'      ? 'selected' : ''}>Duration</option>
            <option value="latency"       ${mt === 'latency'       ? 'selected' : ''}>Latency</option>
            <option value="count_per_day" ${mt === 'count_per_day' ? 'selected' : ''}>Count Per Day</option>
          </select>
        </div>
        <div class="field-group" id="ac-counting-time-group">
          <label for="ac-counting-time">Default counting time (sec)</label>
          <input type="number" id="ac-counting-time" min="1" step="1" value="${pp.default_counting_time ?? ''}">
        </div>
        <div class="field-group pf-checkbox-group" id="ac-neutral-field-group">
          <label><input type="checkbox" id="ac-neutral-field" ${pp.has_neutral_field ? 'checked' : ''}> Has neutral field</label>
        </div>

        <div class="field-group">
          <label for="ac-goal-direction">Goal direction</label>
          <select id="ac-goal-direction" class="invite-select">
            <option value="">No goal set</option>
            <option value="acceleration" ${pp.goal_direction === 'acceleration' ? 'selected' : ''}>Acceleration</option>
            <option value="deceleration" ${pp.goal_direction === 'deceleration' ? 'selected' : ''}>Deceleration</option>
          </select>
        </div>
        <div class="field-group">
          <label for="ac-target-min">Target min</label>
          <input type="number" id="ac-target-min" step="any" value="${pp.target_min ?? ''}">
        </div>
        <div class="field-group">
          <label for="ac-target-max">Target max</label>
          <input type="number" id="ac-target-max" step="any" value="${pp.target_max ?? ''}">
        </div>

        <div class="field-group">
          <label for="ac-default-view">View</label>
          <select id="ac-default-view" class="invite-select">
            ${PF_VIEW_OPTIONS.map(([v, l]) => `<option value="${v}" ${(pp.default_view || 'daily') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="field-group">
          <label for="ac-default-point-display">Point display</label>
          <select id="ac-default-point-display" class="invite-select">
            ${PF_DISPLAY_OPTIONS.map(([v, l]) => `<option value="${v}" ${(pp.default_point_display || 'geometric_mean') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>

        <div class="field-group">
          <label for="ac-correct-label">Correct / success label</label>
          <input type="text" id="ac-correct-label" value="${_esc(pp.correct_label || '')}">
        </div>
        <div class="field-group">
          <label for="ac-incorrect-label">Incorrect / error label</label>
          <input type="text" id="ac-incorrect-label" value="${_esc(pp.incorrect_label || '')}">
        </div>
        <div class="field-group">
          <label for="ac-neutral-label">Neutral label</label>
          <input type="text" id="ac-neutral-label" value="${_esc(pp.neutral_label || '')}">
        </div>
      </div>`;
  }

  _applyTypeMode() {
    const mt = document.getElementById('ac-measurement-type').value;
    document.getElementById('ac-neutral-field-group').style.display  = (mt === 'frequency' || mt === 'count_per_day') ? '' : 'none';
    document.getElementById('ac-counting-time-group').style.display  = (mt === 'frequency') ? '' : 'none';
  }

  async _create(pinpoint) {
    const val = id => document.getElementById(id).value.trim();
    const name = val('ac-name');
    if (!name) { this._feedback('Enter a name.', true); return; }

    const measurement_type = document.getElementById('ac-measurement-type').value;
    const fields = {
      id: pinpoint.id, // provenance FK, via DB.participantPinpoints.add(participantId, pinpointOrFields)
      name,
      description: val('ac-description') || null,
      measurement_type,
      has_neutral_field: (measurement_type === 'frequency' || measurement_type === 'count_per_day')
        && document.getElementById('ac-neutral-field').checked,
      default_counting_time: measurement_type === 'frequency' && val('ac-counting-time')
        ? parseInt(val('ac-counting-time'), 10) : null,
      goal_direction: document.getElementById('ac-goal-direction').value || null,
      target_min: val('ac-target-min') !== '' ? parseFloat(val('ac-target-min')) : null,
      target_max: val('ac-target-max') !== '' ? parseFloat(val('ac-target-max')) : null,
      default_view: document.getElementById('ac-default-view').value,
      default_point_display: document.getElementById('ac-default-point-display').value,
      correct_label: val('ac-correct-label') || null,
      incorrect_label: val('ac-incorrect-label') || null,
      neutral_label: val('ac-neutral-label') || null,
    };

    const btn = document.getElementById('ac-continue');
    btn.disabled = true;
    try {
      const instance = await DB.participantPinpoints.add(this._participant.id, fields);
      // Prefill the chart's legend fields (and, for timing measurements, the
      // default marker shape — latency defaults to "/", duration to "\")
      // immediately so they're not blank the first time the chart is opened.
      // DB.meta.upsert is the same fetch-then-write helper Dashboard uses
      // for the meta-grid, so this stays editable there afterward.
      const metaPrefill = {
        correct: fields.correct_label, incorrect: fields.incorrect_label, neutral: fields.neutral_label
      };
      if (measurement_type === 'latency')  metaPrefill.dotShape = 'slash';
      if (measurement_type === 'duration') metaPrefill.dotShape = 'backslash';
      if (Object.values(metaPrefill).some(v => v != null)) {
        await DB.meta.upsert(instance.id, metaPrefill);
      }
      this.hide();
      // Jump straight into the new chart.
      window.showChart?.(instance.id, {
        teamName: this._teamName, participantName: this._participant.name,
        instanceName: instance.name, participantId: this._participant.id
      });
    } catch (err) {
      this._feedback('Could not create chart: ' + err.message, true);
      btn.disabled = false;
    }
  }

  _feedback(msg, isError) {
    const fb = document.getElementById('ac-feedback');
    if (!fb) return;
    fb.textContent = msg;
    fb.className = 'login-feedback ' + (isError ? 'error' : 'success');
  }
}

function _acCategoryOptionsHTML(categories, selectedId) {
  const opts = ['<option value="">All categories</option>'];
  const byParent = {};
  categories.forEach(c => { (byParent[c.parent_id || ''] ||= []).push(c); });
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
