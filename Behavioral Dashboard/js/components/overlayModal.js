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
    this._behaviors     = [];
    this._domains       = [];
    this._loaded        = false;
    this._overlaySel = [null, null, null]; // remembered dropdown picks: { behaviorId, domainId }
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
    const [teams, participants, behaviors, domains] = await Promise.all([
      DB.teams.getAll(),
      DB.participants.getAll(),
      DB.behaviors.getAll(),
      DB.domains.getAll(),
    ]);
    this._teams = teams || [];
    this._participants = participants || [];
    this._behaviors = behaviors || [];
    this._domains = domains || [];
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
            <select class="invite-select" id="overlay-primary-behavior"></select>
            <select class="invite-select" id="overlay-primary-domain"></select>
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
    const behSel  = document.getElementById('overlay-primary-behavior');

    teamSel?.addEventListener('change', () => {
      partSel.innerHTML = this._participantOptionsHTML(teamSel.value, '');
      behSel.innerHTML  = this._behaviorOptionsHTML('', '');
    });
    partSel?.addEventListener('change', () => {
      behSel.innerHTML = this._behaviorOptionsHTML(partSel.value, '');
    });
  }

  _renderPrimarySelects() {
    const teamSel = document.getElementById('overlay-primary-team');
    const partSel = document.getElementById('overlay-primary-participant');
    const behSel  = document.getElementById('overlay-primary-behavior');
    const domSel  = document.getElementById('overlay-primary-domain');
    if (!teamSel) return;

    // Default to whatever chart is currently loaded on the dashboard, if any.
    let selTeamId = '', selParticipantId = '', selBehaviorId = '', selDomainId = '';
    const bid = this.dashboard?.currentBehaviorId;
    const did = this.dashboard?.currentDomainId;
    if (bid && did) {
      const behavior    = this._behaviors.find(b => String(b.id) === String(bid));
      const participant = behavior ? this._participants.find(p => String(p.id) === String(behavior.participant_id)) : null;
      selBehaviorId    = bid;
      selDomainId      = did;
      selParticipantId = participant ? participant.id : '';
      selTeamId        = participant ? participant.team_id : '';
    }

    teamSel.innerHTML = this._teamOptionsHTML(selTeamId);
    partSel.innerHTML = this._participantOptionsHTML(selTeamId, selParticipantId);
    behSel.innerHTML  = this._behaviorOptionsHTML(selParticipantId, selBehaviorId);
    domSel.innerHTML  = this._domainOptionsHTML(selDomainId);

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
    let selTeamId = '', selParticipantId = '', selBehaviorId = '', selDomainId = '';
    if (sel) {
      const behavior = this._behaviors.find(b => String(b.id) === String(sel.behaviorId));
      const participant = behavior ? this._participants.find(p => String(p.id) === String(behavior.participant_id)) : null;
      selBehaviorId    = sel.behaviorId;
      selDomainId      = sel.domainId;
      selParticipantId = participant ? participant.id : '';
      selTeamId        = participant ? participant.team_id : '';
    }

    const teamOptions        = this._teamOptionsHTML(selTeamId);
    const participantOptions = this._participantOptionsHTML(selTeamId, selParticipantId);
    const behaviorOptions    = this._behaviorOptionsHTML(selParticipantId, selBehaviorId);
    const domainOptions      = this._domainOptionsHTML(selDomainId);

    return `
      <div class="overlay-slot" data-slot="${i}">
        <div class="overlay-slot-header">
          <span class="overlay-slot-title">Overlay ${i + 1}</span>
          <button class="overlay-slot-remove" data-slot="${i}" title="Remove this overlay">Remove</button>
        </div>
        <div class="overlay-slot-selects">
          <select class="invite-select overlay-sel-team" data-slot="${i}">${teamOptions}</select>
          <select class="invite-select overlay-sel-participant" data-slot="${i}">${participantOptions}</select>
          <select class="invite-select overlay-sel-behavior" data-slot="${i}">${behaviorOptions}</select>
          <select class="invite-select overlay-sel-domain" data-slot="${i}">${domainOptions}</select>
        </div>
      </div>`;
  }

  _teamOptionsHTML(selectedId) {
    const opts = ['<option value="">Team…</option>'];
    this._teams.forEach(t => opts.push(`<option value="${t.id}"${String(t.id) === String(selectedId) ? ' selected' : ''}>${_esc(t.name)}</option>`));
    return opts.join('');
  }

  _domainOptionsHTML(selectedId) {
    const opts = ['<option value="">Domain…</option>'];
    this._domains.forEach(d => opts.push(`<option value="${d.id}"${String(d.id) === String(selectedId) ? ' selected' : ''}>${_esc(d.name)}</option>`));
    return opts.join('');
  }

  _participantOptionsHTML(teamId, selectedId) {
    const opts = ['<option value="">Participant…</option>'];
    this._participants
      .filter(p => !teamId || String(p.team_id) === String(teamId))
      .forEach(p => opts.push(`<option value="${p.id}"${String(p.id) === String(selectedId) ? ' selected' : ''}>${_esc(p.name)}</option>`));
    return opts.join('');
  }

  _behaviorOptionsHTML(participantId, selectedId) {
    const opts = ['<option value="">Behavior…</option>'];
    this._behaviors
      .filter(b => !participantId || String(b.participant_id) === String(participantId))
      .forEach(b => opts.push(`<option value="${b.id}"${String(b.id) === String(selectedId) ? ' selected' : ''}>${_esc(b.name)}</option>`));
    return opts.join('');
  }

  _bindSlot(i) {
    const wrap = document.getElementById('overlay-slots');
    const teamSel   = wrap.querySelector(`.overlay-sel-team[data-slot="${i}"]`);
    const partSel   = wrap.querySelector(`.overlay-sel-participant[data-slot="${i}"]`);
    const behSel    = wrap.querySelector(`.overlay-sel-behavior[data-slot="${i}"]`);
    const domSel    = wrap.querySelector(`.overlay-sel-domain[data-slot="${i}"]`);
    const removeBtn = wrap.querySelector(`.overlay-slot-remove[data-slot="${i}"]`);

    const recordSelection = () => {
      const bid = behSel.value, did = domSel.value;
      this._overlaySel[i] = (bid && did) ? { behaviorId: bid, domainId: did } : null;
    };

    teamSel?.addEventListener('change', () => {
      partSel.innerHTML = this._participantOptionsHTML(teamSel.value, '');
      behSel.innerHTML  = this._behaviorOptionsHTML('', '');
      recordSelection();
    });
    partSel?.addEventListener('change', () => {
      behSel.innerHTML = this._behaviorOptionsHTML(partSel.value, '');
      recordSelection();
    });
    behSel?.addEventListener('change', recordSelection);
    domSel?.addEventListener('change', recordSelection);
    removeBtn?.addEventListener('click', () => {
      this._overlaySel[i] = null;
      this._renderSlots();
    });
  }

  // ── View overlay ──────────────────────────────────────────────────────────

  async _onViewOverlay() {
    const bid = document.getElementById('overlay-primary-behavior')?.value;
    const did = document.getElementById('overlay-primary-domain')?.value;
    if (!bid || !did) { this._feedback('Choose a primary chart first.', true); return; }

    const resolve = (behaviorId, domainId) => {
      const behavior    = this._behaviors.find(b => String(b.id) === String(behaviorId));
      const participant = behavior ? this._participants.find(p => String(p.id) === String(behavior.participant_id)) : null;
      const domain      = this._domains.find(d => String(d.id) === String(domainId));
      const label = [participant?.name, behavior?.name, domain?.name].filter(Boolean).join(' › ');
      return { behavior, participant, domain, label };
    };

    const primaryInfo = resolve(bid, did);
    if (!primaryInfo.behavior || !primaryInfo.domain) { this._feedback('Could not resolve the primary selection.', true); return; }

    const overlaySlots = this._overlaySel
      .map((sel, i) => sel ? { i, sel, info: resolve(sel.behaviorId, sel.domainId) } : null)
      .filter(Boolean);

    this._feedback('Loading charts…', false);
    try {
      const [primaryPoints, primaryMeta, ...overlayResults] = await Promise.all([
        DB.points.get(bid, did),
        DB.meta.get(bid, did),
        ...overlaySlots.map(s => DB.points.get(s.sel.behaviorId, s.sel.domainId)),
        ...overlaySlots.map(s => DB.meta.get(s.sel.behaviorId, s.sel.domainId)),
      ]);

      const overlayPointsList = overlayResults.slice(0, overlaySlots.length);
      const overlayMetaList   = overlayResults.slice(overlaySlots.length);

      const palette = this.overlayView.chart.OVERLAY_PALETTE;
      const overlays = [null, null, null];
      overlaySlots.forEach((s, idx) => {
        const colors = palette[s.i] || { dot: '#8e44ad', x: '#e67e22', aim: '#c2185b' };
        overlays[s.i] = {
          behaviorId: s.sel.behaviorId,
          domainId: s.sel.domainId,
          label: s.info.label,
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
      label: 'Demo — Jordan P. › Sight Word Fluency › Movement Fluency',
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
      behaviorId: 'demo-2', domainId: 'demo-2',
      label: 'Demo — Casey M. › Sight Word Fluency › Movement Fluency',
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
