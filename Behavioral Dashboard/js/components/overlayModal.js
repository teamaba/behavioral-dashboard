/**
 * overlayModal.js — Overlay Charts picker
 * A standalone menu (opened from the Overview page, not from any single
 * chart's page) for choosing a primary chart plus up to 3 comparison charts.
 * This modal only selects WHICH charts to compare — no chart data is loaded
 * or editable here. Once "View overlay" is clicked, the read-only Overlay
 * Comparison screen (OverlayView) takes over rendering, styling, and export.
 */

class OverlayModal {
  constructor(dashboard, overlayView) {
    this.dashboard   = dashboard;   // only used to default-prefill the primary picker
    this.overlayView = overlayView; // owns the SCCChart instance that actually renders the comparison
    this._teams        = [];
    this._participants = [];
    this._instances     = [];
    this._loaded        = false;
    this._overlaySel = [null, null, null]; // remembered dropdown picks: { instanceId }
    this._render();
  }

  async show() {
    this.overlay.classList.remove('hidden');
    if (!this._loaded) {
      try { await this._loadHierarchy(); }
      catch (err) { console.error('[OverlayModal]', err); }
    }
    this._feedback('', false);
    this._renderPrimarySelects();
    this._renderSlots();
  }

  hide() { this.overlay.classList.add('hidden'); }

  async _loadHierarchy() {
    const [teams, participants, instances] = await Promise.all([
      DB.teams.getAll(),
      DB.participants.getAll(),
      DB.participantPinpoints.getAll(),
    ]);
    this._teams = teams || [];
    this._participants = participants || [];
    this._instances = instances || [];
    this._loaded = true;
  }

  _render() {
    this.overlay = document.getElementById('overlay-modal-overlay');
    this.overlay.innerHTML = `
      <div class="login-card overlay-modal-card">
        <button class="invite-close" id="overlay-modal-close">&#x2715;</button>
        <div class="login-mode-label">Overlay Charts</div>

        <div class="overlay-primary-section">
          <label class="manage-section-label">Primary chart</label>
          <div class="overlay-slot-selects">
            <select class="invite-select" id="overlay-primary-team"></select>
            <select class="invite-select" id="overlay-primary-participant"></select>
            <select class="invite-select" id="overlay-primary-instance"></select>
          </div>
        </div>

        <div class="overlay-align-row">
          <label class="manage-section-label" for="overlay-align-select">Axis alignment</label>
          <select id="overlay-align-select" class="invite-select">
            <option value="relative">Relative day (each chart's own Day 0)</option>
            <option value="calendar">Calendar date (real dates line up)</option>
          </select>
        </div>

        <label class="manage-section-label" style="margin-top:2px">Overlay charts (up to 3)</label>
        <div id="overlay-slots"></div>

        <div class="overlay-modal-actions">
          <button class="btn-outline" id="overlay-clear-all">Clear selections</button>
          <button class="btn-outline" id="overlay-demo-btn" style="color:#6a3d9a;border-color:#6a3d9a;">Load demo</button>
          <button class="login-btn overlay-view-btn" id="overlay-view-btn">View overlay</button>
        </div>
        <div class="login-feedback" id="overlay-feedback"></div>
      </div>
    `;

    document.getElementById('overlay-modal-close').addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.hide(); });

    document.getElementById('overlay-clear-all').addEventListener('click', () => {
      this._overlaySel = [null, null, null];
      this._renderSlots();
    });

    document.getElementById('overlay-view-btn').addEventListener('click', () => this._onViewOverlay());
    document.getElementById('overlay-demo-btn').addEventListener('click', () => this._loadDemoOverlay());

    this._bindPrimarySelects();
  }

  // ── Primary chart picker ──────────────────────────────────────────────────

  _bindPrimarySelects() {
    const teamSel = document.getElementById('overlay-primary-team');
    const partSel = document.getElementById('overlay-primary-participant');

    teamSel?.addEventListener('change', () => {
      partSel.innerHTML = this._participantOptionsHTML(teamSel.value, '');
      document.getElementById('overlay-primary-instance').innerHTML = this._instanceOptionsHTML('', '');
    });
    partSel?.addEventListener('change', () => {
      document.getElementById('overlay-primary-instance').innerHTML = this._instanceOptionsHTML(partSel.value, '');
    });
  }

  _renderPrimarySelects() {
    const teamSel = document.getElementById('overlay-primary-team');
    const partSel = document.getElementById('overlay-primary-participant');
    const instSel = document.getElementById('overlay-primary-instance');
    if (!teamSel) return;

    // Default to whatever chart is currently loaded on the dashboard, if any.
    let selTeamId = '', selParticipantId = '', selInstanceId = '';
    const iid = this.dashboard?.currentInstanceId;
    if (iid) {
      const instance     = this._instances.find(i => String(i.id) === String(iid));
      const participant  = instance ? this._participants.find(p => String(p.id) === String(instance.participant_id)) : null;
      selInstanceId    = iid;
      selParticipantId = participant ? participant.id : '';
      selTeamId        = participant ? participant.team_id : '';
    }

    teamSel.innerHTML = this._teamOptionsHTML(selTeamId);
    partSel.innerHTML = this._participantOptionsHTML(selTeamId, selParticipantId);
    instSel.innerHTML = this._instanceOptionsHTML(selParticipantId, selInstanceId);

    const alignSel = document.getElementById('overlay-align-select');
    if (alignSel) alignSel.value = this.overlayView.chart.overlayAlign;
  }

  // ── Overlay slot pickers (selection only — no fetch, no styling here) ─────

  _renderSlots() {
    const wrap = document.getElementById('overlay-slots');
    if (!wrap) return;
    wrap.innerHTML = [0, 1, 2].map(i => this._slotHTML(i, this._overlaySel[i])).join('');
    [0, 1, 2].forEach(i => this._bindSlot(i));
  }

  _slotHTML(i, sel) {
    let selTeamId = '', selParticipantId = '', selInstanceId = '';
    if (sel) {
      const instance    = this._instances.find(i2 => String(i2.id) === String(sel.instanceId));
      const participant = instance ? this._participants.find(p => String(p.id) === String(instance.participant_id)) : null;
      selInstanceId    = sel.instanceId;
      selParticipantId = participant ? participant.id : '';
      selTeamId        = participant ? participant.team_id : '';
    }

    const teamOptions        = this._teamOptionsHTML(selTeamId);
    const participantOptions = this._participantOptionsHTML(selTeamId, selParticipantId);
    const instanceOptions    = this._instanceOptionsHTML(selParticipantId, selInstanceId);

    return `
      <div class="overlay-slot" data-slot="${i}">
        <div class="overlay-slot-header">
          <span class="overlay-slot-title">Overlay ${i + 1}</span>
          <button class="overlay-slot-remove" data-slot="${i}" title="Remove this overlay">Remove</button>
        </div>
        <div class="overlay-slot-selects">
          <select class="invite-select overlay-sel-team" data-slot="${i}">${teamOptions}</select>
          <select class="invite-select overlay-sel-participant" data-slot="${i}">${participantOptions}</select>
          <select class="invite-select overlay-sel-instance" data-slot="${i}">${instanceOptions}</select>
        </div>
      </div>`;
  }

  _teamOptionsHTML(selectedId) {
    const opts = ['<option value="">Team…</option>'];
    this._teams.forEach(t => opts.push(`<option value="${t.id}"${String(t.id) === String(selectedId) ? ' selected' : ''}>${_esc(t.name)}</option>`));
    return opts.join('');
  }

  _participantOptionsHTML(teamId, selectedId) {
    const opts = ['<option value="">Participant…</option>'];
    this._participants
      .filter(p => !teamId || String(p.team_id) === String(teamId))
      .forEach(p => opts.push(`<option value="${p.id}"${String(p.id) === String(selectedId) ? ' selected' : ''}>${_esc(p.name)}</option>`));
    return opts.join('');
  }

  _instanceOptionsHTML(participantId, selectedId) {
    const opts = ['<option value="">Pinpoint…</option>'];
    this._instances
      .filter(i => !participantId || String(i.participant_id) === String(participantId))
      .forEach(i => opts.push(`<option value="${i.id}"${String(i.id) === String(selectedId) ? ' selected' : ''}>${_esc(i.name)}</option>`));
    return opts.join('');
  }

  _bindSlot(i) {
    const wrap = document.getElementById('overlay-slots');
    const teamSel   = wrap.querySelector(`.overlay-sel-team[data-slot="${i}"]`);
    const partSel   = wrap.querySelector(`.overlay-sel-participant[data-slot="${i}"]`);
    const instSel    = wrap.querySelector(`.overlay-sel-instance[data-slot="${i}"]`);
    const removeBtn = wrap.querySelector(`.overlay-slot-remove[data-slot="${i}"]`);

    const recordSelection = () => {
      const iid = instSel.value;
      this._overlaySel[i] = iid ? { instanceId: iid } : null;
    };

    teamSel?.addEventListener('change', () => {
      partSel.innerHTML = this._participantOptionsHTML(teamSel.value, '');
      instSel.innerHTML  = this._instanceOptionsHTML('', '');
      recordSelection();
    });
    partSel?.addEventListener('change', () => {
      instSel.innerHTML = this._instanceOptionsHTML(partSel.value, '');
      recordSelection();
    });
    instSel?.addEventListener('change', recordSelection);
    removeBtn?.addEventListener('click', () => {
      this._overlaySel[i] = null;
      this._renderSlots();
    });
  }

  // ── View overlay ──────────────────────────────────────────────────────────

  async _onViewOverlay() {
    const iid = document.getElementById('overlay-primary-instance')?.value;
    if (!iid) { this._feedback('Choose a primary chart first.', true); return; }

    const resolve = instanceId => {
      const instance    = this._instances.find(i => String(i.id) === String(instanceId));
      const participant = instance ? this._participants.find(p => String(p.id) === String(instance.participant_id)) : null;
      const label = [participant?.name, instance?.name].filter(Boolean).join(' › ');
      return { instance, participant, label };
    };

    const primaryInfo = resolve(iid);
    if (!primaryInfo.instance) { this._feedback('Could not resolve the primary selection.', true); return; }

    const overlaySlots = this._overlaySel
      .map((sel, i) => sel ? { i, sel, info: resolve(sel.instanceId) } : null)
      .filter(Boolean);

    this._feedback('Loading charts…', false);
    try {
      const [primaryPoints, primaryMeta, ...overlayResults] = await Promise.all([
        DB.points.get(iid),
        DB.meta.get(iid),
        ...overlaySlots.map(s => DB.points.get(s.sel.instanceId)),
        ...overlaySlots.map(s => DB.meta.get(s.sel.instanceId)),
      ]);

      const overlayPointsList = overlayResults.slice(0, overlaySlots.length);
      const overlayMetaList   = overlayResults.slice(overlaySlots.length);

      const palette = this.overlayView.chart.OVERLAY_PALETTE;
      const overlays = [null, null, null];
      overlaySlots.forEach((s, idx) => {
        const colors = palette[s.i] || { dot: '#8e44ad', x: '#e67e22', aim: '#c2185b' };
        overlays[s.i] = {
          instanceId: s.sel.instanceId,
          label: s.info.label,
          measurementType: s.info.instance.measurement_type,
          rawPoints: (overlayPointsList[idx] || []).map(p => ({
            type: p.type, day: p.day, val: p.val, note: p.note, floor: p.floor || null,
          })),
          ownMeta: overlayMetaList[idx] || {},
          style: {
            dotColor: colors.dot, dotShape: 'circle',
            xColor:   colors.x,   xShape:   'x',
            trendDotColor: colors.dot, trendXColor: colors.x,
            aimColor: colors.aim,
            showTrendlines: true,
            showPhaseLines: false,
            showAimBand: true,
          },
        };
      });

      const primary = {
        label: primaryInfo.label,
        measurementType: primaryInfo.instance.measurement_type,
        points: (primaryPoints || []).map(p => ({
          id: p.id, type: p.type, day: p.day, val: p.val, note: p.note, floor: p.floor || null,
        })),
        meta: primaryMeta || {},
      };

      const align = document.getElementById('overlay-align-select')?.value || 'relative';
      this.overlayView.show(primary, overlays, align);
      this._feedback('', false);
      this.hide();
    } catch (err) {
      this._feedback('Could not load one of the charts: ' + err.message, true);
      console.error('[OverlayModal]', err);
    }
  }

  // ── Demo ──────────────────────────────────────────────────────────────────
  // Loads two synthetic charts through the exact same OverlayView.show() path
  // used for real data, so it renders identically to a real two-chart overlay.

  _loadDemoOverlay() {
    const mk = (type, day, val, note = '') => ({ type, day, val, note, floor: null });

    // Primary — "Jordan P.": accelerating correct responses, decelerating errors.
    const primaryDots = [
      [3, 20], [7, 24], [10, 28], [14, 34], [18, 40],
      [21, 48], [25, 55], [28, 62], [32, 70], [35, 78],
    ];
    const primaryErrs = [
      [3, 18], [7, 15], [10, 13], [14, 11], [18, 9],
      [21, 8], [25, 6], [28, 5], [32, 4], [35, 3],
    ];
    const primary = {
      label: 'Demo — Jordan P. › Sight Word Fluency',
      measurementType: 'frequency',
      points: [
        ...primaryDots.map(([day, val], idx) => mk('dot', day, val, idx === 0 ? 'Baseline session' : '')),
        ...primaryErrs.map(([day, val]) => mk('x', day, val)),
        mk('intervention', 18, null, 'Timed drill added'),
      ],
      meta: {
        startDate: '2025-01-01',
        organization: 'Team ABA', supervisor: 'Demo Supervisor',
        correct: 'Words Read Correctly', incorrect: 'Errors',
        acceltarget: '1.5', deceltarget: '1.3',
        aim_low: 80, aim_high: 120,
        dotColor: '#009933', dotShape: 'circle',
        xColor: '#cc0000', xShape: 'x',
      },
    };

    // Overlay — "Casey M.": slower-accelerating correct responses, slower-decelerating
    // errors, starting two weeks later — good for demonstrating relative vs. calendar alignment.
    const overlayDots = [
      [3, 10], [7, 12], [10, 13], [14, 15], [18, 17],
      [21, 19], [25, 21], [28, 23], [32, 25], [35, 27],
    ];
    const overlayErrs = [
      [3, 22], [7, 20], [10, 19], [14, 18], [18, 17],
      [21, 16], [25, 15], [28, 15], [32, 14], [35, 14],
    ];
    const colors = this.overlayView.chart.OVERLAY_PALETTE[0] || { dot: '#8e44ad', x: '#e67e22', aim: '#c2185b' };
    const overlay = {
      instanceId: 'demo-2',
      label: 'Demo — Casey M. › Sight Word Fluency',
      measurementType: 'frequency',
      rawPoints: [
        ...overlayDots.map(([day, val]) => mk('dot', day, val)),
        ...overlayErrs.map(([day, val]) => mk('x', day, val)),
      ],
      ownMeta: { startDate: '2025-01-15', aim_low: 60, aim_high: 100 },
      style: {
        dotColor: colors.dot, dotShape: 'circle',
        xColor:   colors.x,   xShape:   'x',
        trendDotColor: colors.dot, trendXColor: colors.x,
        aimColor: colors.aim,
        showTrendlines: true,
        showPhaseLines: false,
        showAimBand: true,
      },
    };

    document.getElementById('overlay-align-select').value = 'relative';
    this.overlayView.show(primary, [overlay, null, null], 'relative');
    this.hide();
  }

  _feedback(msg, isError) {
    const fb = document.getElementById('overlay-feedback');
    if (!fb) return;
    fb.textContent = msg;
    fb.className = 'login-feedback ' + (isError ? 'error' : 'success');
  }
}
