/**
 * hierarchyView.js — Full-screen hierarchy home page
 * Teams → Participants → Pinpoint chart instances (sorted by last access)
 *
 * Supervisors: add teams, add participants, manage notification list.
 * Staff:       assign pinpoints to existing participants via Add Chart.
 * Clients:     own pinpoint charts only, read-only.
 */

class HierarchyView {
  constructor(onSelect) {
    this._onSelect     = onSelect;
    this._el           = document.getElementById('hierarchy-view');
    this._content      = document.getElementById('hv-content');
    this._eventsBound  = false;
    document.getElementById('hv-search')?.addEventListener('input', () => this._applySearchFilter());
  }

  async show() {
    this._el.classList.remove('hidden');
    this._content.innerHTML = '<p class="hv-loading">Loading&#8230;</p>';
    try {
      if (DB.auth.isStaff() || DB.auth.isGuide()) {
        // Guides reuse the staff-style tree — RLS scopes teams/participants/instances
        // to only what they've been granted, and canEdit-gating below hides the
        // add/edit affordances for them.
        await this._renderStaff();
      } else {
        await this._renderParticipant();
      }
    } catch (err) {
      this._content.innerHTML =
        `<p class="hv-error">Could not load hierarchy: ${_hvEsc(err.message)}</p>`;
      console.error('[HierarchyView]', err);
    }
  }

  hide() { this._el.classList.add('hidden'); }

  // ── Access tracking ─────────────────────────────────────────────────────

  _getAccess(instanceId) {
    const v = localStorage.getItem(`bd_access:${instanceId}`);
    return v ? parseInt(v, 10) : 0;
  }

  recordAccess(instanceId) {
    localStorage.setItem(`bd_access:${instanceId}`, Date.now().toString());
  }

  _sortedInstances(instances) {
    return [...instances].sort((a, b) => this._getAccess(b.id) - this._getAccess(a.id));
  }

  // ── Staff rendering ─────────────────────────────────────────────────────

  async _renderStaff() {
    const canEdit  = DB.auth.isStaff();      // false for Guides — read-only viewers of their assigned participants
    const isSuper  = DB.auth.isSupervisor(); // guide assignment is supervisor-only
    const [teams, participants, instances, nonEmptyIds] = await Promise.all([
      DB.teams.getAll(), DB.participants.getAll(), DB.participantPinpoints.getAll(),
      DB.points.getNonEmptyInstanceIds()
    ]);
    this._nonEmptyIds = new Set(nonEmptyIds);
    let allNotifEmails = [];
    let allGuides = [], allGuideAssignments = [];
    if (canEdit) {
      try { allNotifEmails = (await DB.notifications.getAll()) || []; } catch (_) { /* table not yet created */ }
    }
    if (isSuper) {
      try {
        [allGuides, allGuideAssignments] = await Promise.all([
          DB.guides.getAll(), DB.guides.getAllAssignments()
        ]);
      } catch (_) { /* guide-role-migration.sql not yet run */ }
    }

    const byTeam = {}, byPart = {}, notifByPart = {}, guidesByPart = {};
    participants.forEach(p => {
      if (!byTeam[p.team_id]) byTeam[p.team_id] = [];
      byTeam[p.team_id].push(p);
    });
    instances.forEach(i => {
      if (!byPart[i.participant_id]) byPart[i.participant_id] = [];
      byPart[i.participant_id].push(i);
    });
    allNotifEmails.forEach(n => {
      if (!notifByPart[n.participant_id]) notifByPart[n.participant_id] = [];
      notifByPart[n.participant_id].push(n);
    });
    allGuideAssignments.forEach(g => {
      if (!guidesByPart[g.participant_id]) guidesByPart[g.participant_id] = [];
      guidesByPart[g.participant_id].push({ guideUserId: g.guide_user_id, email: g.profiles?.email || '' });
    });

    if (!teams.length) {
      this._content.innerHTML = `
        <div class="hv-empty">
          ${canEdit ? this._pinpointsBannerHTML() : ''}
          <p class="hv-empty-msg">${canEdit ? 'No teams yet.' : 'No clients assigned yet — contact your supervisor.'}</p>
          ${isSuper ? this._addTeamHTML() : ''}
        </div>`;
      this._bindEvents();
      return;
    }

    this._notifByPart  = notifByPart;
    this._canEdit      = canEdit;
    this._isSuper      = isSuper;
    this._allGuides    = allGuides;
    this._content.innerHTML =
      (canEdit ? this._pinpointsBannerHTML() : '') +
      teams.map(team => this._teamHTML(team, byTeam[team.id] || [], byPart, notifByPart, guidesByPart)).join('') +
      this._supervisorPanelHTML();

    this._bindEvents();
    this._applySearchFilter();
  }

  // ── Search ───────────────────────────────────────────────────────────────

  _applySearchFilter() {
    const input = document.getElementById('hv-search');
    const q = (input?.value || '').trim().toLowerCase();
    const teamSections = this._content.querySelectorAll('.hv-team');
    let anyVisible = false;

    teamSections.forEach(teamEl => {
      const teamName = (teamEl.querySelector('.hv-team-name')?.textContent || '').toLowerCase();
      const teamMatches = !q || teamName.includes(q);
      let anyCardVisible = false;

      teamEl.querySelectorAll('.hv-card').forEach(cardEl => {
        let cardMatches = !q || teamMatches;
        if (!cardMatches) {
          const pname = (cardEl.querySelector('.hv-card-name')?.textContent || '').toLowerCase();
          const instanceNames = [...cardEl.querySelectorAll('.pl-pinpoint-name')].map(el => el.textContent.toLowerCase());
          cardMatches = pname.includes(q) || instanceNames.some(n => n.includes(q));
        }
        cardEl.style.display = cardMatches ? '' : 'none';
        if (cardMatches) anyCardVisible = true;

        // While actively searching, auto-expand matching cards so results are
        // visible without an extra click; collapse back once the query is cleared.
        const body = cardEl.querySelector('.hv-body');
        const chev = cardEl.querySelector('.hv-card-chev');
        if (body) {
          if (q && cardMatches) {
            body.classList.remove('hidden');
            if (chev) chev.innerHTML = '&#9660;';
          } else if (!q) {
            body.classList.add('hidden');
            if (chev) chev.innerHTML = '&#9654;';
          }
        }
      });

      const teamVisible = !q || teamMatches || anyCardVisible;
      teamEl.style.display = teamVisible ? '' : 'none';
      if (teamVisible) anyVisible = true;
    });

    let emptyMsg = document.getElementById('hv-search-empty');
    if (q && !anyVisible) {
      if (!emptyMsg) {
        emptyMsg = document.createElement('p');
        emptyMsg.id = 'hv-search-empty';
        emptyMsg.className = 'hv-search-empty';
        this._content.insertBefore(emptyMsg, this._content.firstChild);
      }
      emptyMsg.textContent = `No matches for "${input.value.trim()}".`;
    } else {
      emptyMsg?.remove();
    }
  }

  // ── HTML builders ────────────────────────────────────────────────────────

  _pinpointsBannerHTML() {
    return `
      <button class="hv-pinpoints-banner" id="hv-pinpoints-banner-btn">
        <span class="hv-pinpoints-banner-title">Pinpoints Library</span>
        <span class="hv-pinpoints-banner-sub">Manage reusable pinpoint templates and folders</span>
      </button>`;
  }

  _teamHTML(team, participants, byPart, notifByPart = {}, guidesByPart = {}) {
    const cards = participants.map(p =>
      this._participantCard(p, byPart[p.id] || [], team.name, notifByPart[p.id] || [], guidesByPart[p.id] || [])
    ).join('');
    const addPart = DB.auth.isSupervisor() ? `
      <div class="hv-add-participant-row">
        <input class="hv-add-input hv-add-part-name" type="text"
               placeholder="Participant name&#8230;"
               data-tid="${_hvEsc(team.id)}" data-tname="${_hvEsc(team.name)}">
        <input class="hv-add-input hv-add-part-age" type="number" min="0" step="1"
               placeholder="Age (optional)" style="max-width:110px">
        <input class="hv-add-input hv-add-part-gender" type="text"
               placeholder="Gender (optional)" style="max-width:150px">
        <button class="hv-add-btn hv-add-part-btn"
                data-tid="${_hvEsc(team.id)}" data-tname="${_hvEsc(team.name)}">+</button>
      </div>` : '';
    return `
      <section class="hv-team">
        <h2 class="hv-team-name">${_hvEsc(team.name)}</h2>
        <div class="hv-cards" id="hv-cards-${_hvEsc(team.id)}">
          ${cards || '<p class="hv-no-participants">No participants yet.</p>'}
        </div>
        ${addPart}
      </section>`;
  }

  _participantCard(p, instances, teamName, notifEmails = [], guides = []) {
    const canEdit = DB.auth.isStaff();
    const isSuper = DB.auth.isSupervisor();
    const sorted  = this._sortedInstances(instances);
    const instanceTable = sorted.length ? this._instanceTableHTML(sorted, p, teamName) : '';
    const notifRows = notifEmails.map(n => `
      <div class="hv-pnotif-row" data-nid="${n.id}">
        <span class="hv-pnotif-email">${_hvEsc(n.email)}</span>
        ${n.label ? `<span class="hv-notify-label-tag">${_hvEsc(n.label)}</span>` : ''}
        <button class="hv-notify-del" data-nid="${n.id}" title="Remove">&#10005;</button>
      </div>`).join('');

    const clientEmailRow = canEdit ? `
        <div class="hv-client-email-row">
          <label class="hv-client-email-label">Client login emails</label>
          <input class="hv-client-email-input" type="email"
                 placeholder="Not set"
                 value="${_hvEsc(p.email || '')}"
                 data-pid="${_hvEsc(p.id)}"
                 data-orig="${_hvEsc(p.email || '')}">
        </div>` : '';

    const notifSection = canEdit ? `
        <div class="hv-client-email-row">
          <label class="hv-client-email-label">Goal notification emails</label>
          <div class="hv-pnotif-list" id="hv-pnotif-${_hvEsc(p.id)}">
            ${notifRows || '<p class="hv-notify-empty">None added yet.</p>'}
          </div>
          <div class="hv-pnotif-add-row">
            <input class="hv-add-input hv-pnotif-email-input" type="email"
                   placeholder="email@example.com" data-pid="${_hvEsc(p.id)}">
            <input class="hv-add-input hv-pnotif-label-input" type="text"
                   placeholder="Label (optional)" data-pid="${_hvEsc(p.id)}">
            <button class="hv-add-btn hv-pnotif-add-btn" data-pid="${_hvEsc(p.id)}">+</button>
          </div>
        </div>` : '';

    const guideSection = isSuper ? this._guideSectionHTML(p, guides) : '';

    const addChartRow = canEdit ? `
        <div class="hv-add-row">
          <button class="hv-add-btn hv-addchart-btn"
                  data-pid="${_hvEsc(p.id)}" data-tname="${_hvEsc(teamName)}" data-pname="${_hvEsc(p.name)}">+ Add Chart</button>
        </div>` : '';

    const bodyId     = `hv-body-${_hvEsc(p.id)}`;
    const chevId      = `hv-chev-${_hvEsc(p.id)}`;
    const settingsId = `hv-settings-${_hvEsc(p.id)}`;
    const hasSettings = canEdit || isSuper;

    const gearBtn = hasSettings ? `
        <button class="hv-gear-btn js-toggle" data-target="${settingsId}" title="Manage emails &amp; access">&#9881;</button>` : '';

    const settingsPopover = hasSettings ? `
        <div class="hv-settings-popover hidden" id="${settingsId}">
          ${clientEmailRow}
          ${notifSection}
          ${guideSection}
        </div>` : '';

    return `
      <div class="hv-card">
        <div class="hv-card-hdr js-toggle" data-target="${bodyId}" data-chev="${chevId}">
          <span class="hv-card-chev" id="${chevId}">&#9654;</span>
          <span class="hv-card-name">${_hvEsc(p.name)}</span>
          ${gearBtn}
        </div>
        ${settingsPopover}
        <div class="hv-body hidden" id="${bodyId}">
          <div class="hv-behaviors" id="hv-insts-${p.id}">
            ${instanceTable || '<p class="hv-no-behaviors">No pinpoints yet.</p>'}
          </div>
          ${addChartRow}
        </div>
      </div>`;
  }

  _guideSectionHTML(p, guides) {
    const assignedIds = new Set(guides.map(g => g.guideUserId));
    const chips = guides.map(g => `
      <span class="hv-guide-chip" data-pid="${_hvEsc(p.id)}" data-gid="${_hvEsc(g.guideUserId)}">
        ${_hvEsc(g.email)}
        <button class="hv-guide-chip-del" data-pid="${_hvEsc(p.id)}" data-gid="${_hvEsc(g.guideUserId)}" title="Remove access">&#10005;</button>
      </span>`).join('');
    const available = (this._allGuides || []).filter(g => !assignedIds.has(g.id));
    const options = ['<option value="">Choose a guide…</option>']
      .concat(available.map(g => `<option value="${_hvEsc(g.id)}">${_hvEsc(g.email)}</option>`)).join('');

    return `
        <div class="hv-client-email-row">
          <label class="hv-client-email-label">Guides with access</label>
          <div class="hv-guide-chips" id="hv-guides-${_hvEsc(p.id)}">
            ${chips || '<p class="hv-notify-empty">No guides assigned.</p>'}
          </div>
          <div class="hv-pnotif-add-row">
            <select class="hv-guide-select" data-pid="${_hvEsc(p.id)}">${options}</select>
            <button class="hv-add-btn hv-guide-add-btn" data-pid="${_hvEsc(p.id)}">+</button>
          </div>
        </div>`;
  }

  _instanceTableHTML(instances, p, teamName) {
    return `
      <table class="pl-pinpoint-table">
        <thead><tr><th>Pinpoint</th><th>Type</th><th></th></tr></thead>
        <tbody>
          ${instances.map(inst => this._instanceRow(inst, p, teamName)).join('')}
        </tbody>
      </table>`;
  }

  _instanceRow(inst, p, teamName) {
    const hasData = this._nonEmptyIds?.has(inst.id) ?? false;
    const delBtn = DB.auth.isStaff()
      ? `<button class="hv-del-beh" data-iid="${inst.id}" data-iname="${_hvEsc(inst.name)}" title="Remove pinpoint">&#10005;</button>`
      : '';
    return `
      <tr class="hv-pinpoint-row${hasData ? ' hv-pinpoint-row--has-data' : ''}" id="hv-inst-${inst.id}"
          data-iid="${inst.id}" data-partid="${_hvEsc(p.id)}"
          data-tname="${_hvEsc(teamName)}" data-pname="${_hvEsc(p.name)}" data-iname="${_hvEsc(inst.name)}">
        <td class="pl-pinpoint-name">${_hvEsc(inst.name)}</td>
        <td><span class="pl-pinpoint-type-tag">${_hvEsc(_hvTypeLabelShort(inst.measurement_type))}</span></td>
        <td class="hv-pinpoint-actions">${delBtn}</td>
      </tr>`;
  }

  _addTeamHTML() {
    return `
      <div class="hv-add-team-row">
        <input class="hv-add-input" type="text" id="hv-add-team-input" placeholder="Team name&#8230;">
        <button class="hv-add-btn" id="hv-add-team-btn">+ Add team</button>
      </div>`;
  }

  _supervisorPanelHTML() {
    if (!DB.auth.isSupervisor()) return '';
    return `
      <div class="hv-supervisor-panel">
        <section class="hv-sup-section">
          <h3 class="hv-sup-title">Add team</h3>
          ${this._addTeamHTML()}
        </section>
      </div>`;
  }

  _renderNotifList(emails) {
    const el = document.getElementById('hv-notify-list');
    if (!el) return;
    if (!emails.length) {
      el.innerHTML = '<p class="hv-notify-empty">No addresses added yet.</p>';
      return;
    }
    el.innerHTML = emails.map(n => `
      <div class="hv-notify-row" data-nid="${n.id}">
        <span class="hv-notify-email">${_hvEsc(n.email)}</span>
        ${n.label ? `<span class="hv-notify-label-tag">${_hvEsc(n.label)}</span>` : ''}
        <button class="hv-notify-del" data-nid="${n.id}" title="Remove">&#10005;</button>
      </div>`).join('');
  }

  // ── Participant (client) rendering ──────────────────────────────────────

  async _renderParticipant() {
    const self = await DB.participants.getSelf();
    if (!self) {
      this._content.innerHTML =
        '<p class="hv-empty-msg">No pinpoints found. Contact your coach or supervisor.</p>';
      return;
    }
    const [instances, nonEmptyIds] = await Promise.all([
      DB.participantPinpoints.get(self.id),
      DB.points.getNonEmptyInstanceIds()
    ]);
    this._nonEmptyIds = new Set(nonEmptyIds);
    const teamName  = (self.teams && self.teams.name) || '';
    const sorted = this._sortedInstances(instances);
    const table = sorted.length ? this._instanceTableHTML(sorted, self, teamName) : '';
    this._content.innerHTML = `
      <section class="hv-team">
        <div class="hv-cards">
          <div class="hv-card">
            <div class="hv-card-name">${_hvEsc(self.name)}</div>
            <div class="hv-behaviors">
              ${table || '<p class="hv-no-behaviors">No pinpoints yet.</p>'}
            </div>
          </div>
        </div>
      </section>`;
    this._bindEvents();
  }

  // ── Events ──────────────────────────────────────────────────────────────

  _bindEvents() {
    if (this._eventsBound) return;
    this._eventsBound = true;
    this._content.addEventListener('click', e => {
      const pinpointsBanner = e.target.closest('#hv-pinpoints-banner-btn');
      if (pinpointsBanner) { window.pinpointsLibrary?.show(); return; }

      // Delete button must be checked before the row-select below, since
      // it's nested inside the same clickable .hv-pinpoint-row now.
      const delInst = e.target.closest('.hv-del-beh');
      if (delInst) {
        e.stopPropagation();
        this._confirmDeleteInstance(delInst.dataset.iid, delInst.dataset.iname);
        return;
      }

      const instRow = e.target.closest('.hv-pinpoint-row');
      if (instRow) { this._selectInstance(instRow); return; }

      const toggle = e.target.closest('.js-toggle');
      if (toggle) { this._toggle(toggle); return; }

      const guideAddBtn = e.target.closest('.hv-guide-add-btn');
      if (guideAddBtn) { this._addGuideToParticipant(guideAddBtn.dataset.pid); return; }

      const guideDelBtn = e.target.closest('.hv-guide-chip-del');
      if (guideDelBtn) { this._removeGuideFromParticipant(guideDelBtn.dataset.pid, guideDelBtn.dataset.gid); return; }

      // Add Chart — opens the pinpoint-assignment modal
      const addChartBtn = e.target.closest('.hv-addchart-btn');
      if (addChartBtn) {
        this._openAddChart(addChartBtn.dataset.pid, addChartBtn.dataset.tname, addChartBtn.dataset.pname);
        return;
      }

      // Add participant — supervisor only
      const addPartBtn = e.target.closest('.hv-add-part-btn');
      if (addPartBtn) {
        const tid    = addPartBtn.dataset.tid;
        const nameEl = this._content.querySelector(`.hv-add-part-name[data-tid="${tid}"]`);
        this._addParticipant(addPartBtn, nameEl);
        return;
      }

      if (e.target.id === 'hv-add-team-btn')  { this._addTeam();     return; }

      const addNotifBtn = e.target.closest('.hv-pnotif-add-btn');
      if (addNotifBtn) { this._addParticipantNotif(addNotifBtn.dataset.pid); return; }

      const delNotif = e.target.closest('.hv-notify-del');
      if (delNotif) { this._deleteNotifEmail(delNotif.dataset.nid, delNotif.closest('.hv-pnotif-row')); return; }
    });

    this._content.addEventListener('blur', e => {
      const emailInput = e.target.closest('.hv-client-email-input');
      if (emailInput) this._saveClientEmail(emailInput);
    }, true);

    this._content.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;

      // Client login email — blur to save
      const loginEmailInput = e.target.closest('.hv-client-email-input');
      if (loginEmailInput) { loginEmailInput.blur(); return; }

      // Notification email inputs — add notif email
      const notifInput = e.target.closest('.hv-pnotif-email-input, .hv-pnotif-label-input');
      if (notifInput) { this._addParticipantNotif(notifInput.dataset.pid); return; }

      // Participant name/age/gender inputs — Enter to add
      const partInput = e.target.closest('.hv-add-part-name, .hv-add-part-age, .hv-add-part-gender');
      if (partInput) {
        const tid = partInput.closest('.hv-add-participant-row')?.querySelector('.hv-add-part-name')?.dataset.tid;
        const btn = this._content.querySelector(`.hv-add-part-btn[data-tid="${tid}"]`);
        const nameEl = this._content.querySelector(`.hv-add-part-name[data-tid="${tid}"]`);
        if (btn) this._addParticipant(btn, nameEl);
        return;
      }

      if (e.target.id === 'hv-add-team-input') { this._addTeam(); return; }
    });
  }

  _toggle(el) {
    const body = document.getElementById(el.dataset.target);
    const chev = el.dataset.chev ? document.getElementById(el.dataset.chev) : null;
    if (!body) return;
    const closing = !body.classList.contains('hidden');
    body.classList.toggle('hidden');
    if (chev) chev.innerHTML = closing ? '&#9654;' : '&#9660;';
  }

  _selectInstance(el) {
    const { iid, partid, tname, pname, iname } = el.dataset;
    this.recordAccess(iid);
    this._onSelect(iid, { teamName: tname, participantName: pname, instanceName: iname, participantId: partid });
  }

  _openAddChart(pid, tname, pname) {
    if (window.addChartModal) {
      window.addChartModal.show({ id: pid, name: pname }, tname);
    } else {
      alert('Add Chart is not available yet.');
    }
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  async _saveClientEmail(input) {
    const email = input.value.trim();
    const orig  = input.dataset.orig || '';
    if (email === orig) return;
    const pid = input.dataset.pid;
    input.classList.add('hv-client-email-input--saving');
    try {
      await DB.participants.update(pid, { email: email || null });
      // Also register in allowed_emails so the client can sign in without a separate invite step
      if (email) {
        try { await DB.invites.add(email, 'client', null); } catch (_) { /* already exists — fine */ }
      }
      input.dataset.orig = email;
      input.classList.remove('hv-client-email-input--saving');
      input.classList.add('hv-client-email-input--saved');
      setTimeout(() => input.classList.remove('hv-client-email-input--saved'), 1500);
    } catch (err) {
      input.value = orig;
      input.classList.remove('hv-client-email-input--saving');
      alert('Could not save email: ' + err.message);
    }
  }

  async _addParticipant(btn, nameEl) {
    const name = nameEl?.value.trim();
    if (!name) { nameEl?.focus(); return; }
    const { tid, tname } = btn.dataset;
    const row = btn.closest('.hv-add-participant-row');
    const ageEl    = row?.querySelector('.hv-add-part-age');
    const genderEl = row?.querySelector('.hv-add-part-gender');
    const age    = ageEl?.value ? parseInt(ageEl.value, 10) : null;
    const gender = genderEl?.value.trim() || null;
    nameEl.disabled = btn.disabled = true;
    try {
      const p = await DB.participants.add(tid, name, null, age, gender);
      const container = document.getElementById(`hv-cards-${tid}`);
      if (container) {
        container.querySelector('.hv-no-participants')?.remove();
        container.insertAdjacentHTML('beforeend', this._participantCard(p, [], tname));
      }
      nameEl.value = '';
      if (ageEl) ageEl.value = '';
      if (genderEl) genderEl.value = '';
      this._applySearchFilter();
    } catch (err) {
      alert('Could not add participant: ' + err.message);
    } finally {
      nameEl.disabled = btn.disabled = false;
      nameEl.focus();
    }
  }

  async _addTeam() {
    const input = document.getElementById('hv-add-team-input');
    const name  = input?.value.trim();
    if (!name) { input?.focus(); return; }
    const btn = document.getElementById('hv-add-team-btn');
    if (input) input.disabled = true;
    if (btn)   btn.disabled   = true;
    try {
      const team = await DB.teams.add(name);
      const panel = this._content.querySelector('.hv-supervisor-panel');
      const html  = this._teamHTML(team, [], {});
      panel ? panel.insertAdjacentHTML('beforebegin', html)
            : this._content.insertAdjacentHTML('beforeend', html);
      if (input) input.value = '';
      this._applySearchFilter();
    } catch (err) {
      alert('Could not add team: ' + err.message);
    } finally {
      if (input) input.disabled = false;
      if (btn)   btn.disabled   = false;
      input?.focus();
    }
  }

  async _addNotifEmail() {
    const emailEl = document.getElementById('hv-notify-email');
    const labelEl = document.getElementById('hv-notify-label');
    const email   = emailEl?.value.trim();
    const label   = labelEl?.value.trim();
    if (!email) { emailEl?.focus(); return; }
    const btn = document.getElementById('hv-notify-add-btn');
    if (btn) btn.disabled = true;
    try {
      const row = await DB.notifications.add(email, label || null);
      const list = document.getElementById('hv-notify-list');
      if (list) {
        list.querySelector('.hv-notify-empty')?.remove();
        list.insertAdjacentHTML('beforeend', `
          <div class="hv-notify-row" data-nid="${row.id}">
            <span class="hv-notify-email">${_hvEsc(row.email)}</span>
            ${row.label ? `<span class="hv-notify-label-tag">${_hvEsc(row.label)}</span>` : ''}
            <button class="hv-notify-del" data-nid="${row.id}" title="Remove">&#10005;</button>
          </div>`);
      }
      if (emailEl) emailEl.value = '';
      if (labelEl) labelEl.value = '';
    } catch (err) {
      alert('Could not add email: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
      emailEl?.focus();
    }
  }

  async _addParticipantNotif(pid) {
    const emailEl = this._content.querySelector(`.hv-pnotif-email-input[data-pid="${pid}"]`);
    const labelEl = this._content.querySelector(`.hv-pnotif-label-input[data-pid="${pid}"]`);
    const btn     = this._content.querySelector(`.hv-pnotif-add-btn[data-pid="${pid}"]`);
    const email   = emailEl?.value.trim();
    if (!email) { emailEl?.focus(); return; }
    if (btn) btn.disabled = true;
    try {
      const row = await DB.notifications.add(pid, email, labelEl?.value.trim() || null);
      const list = document.getElementById(`hv-pnotif-${pid}`);
      if (list) {
        list.querySelector('.hv-notify-empty')?.remove();
        list.insertAdjacentHTML('beforeend', `
          <div class="hv-pnotif-row" data-nid="${row.id}">
            <span class="hv-pnotif-email">${_hvEsc(row.email)}</span>
            ${row.label ? `<span class="hv-notify-label-tag">${_hvEsc(row.label)}</span>` : ''}
            <button class="hv-notify-del" data-nid="${row.id}" title="Remove">&#10005;</button>
          </div>`);
      }
      if (emailEl) emailEl.value = '';
      if (labelEl) labelEl.value = '';
    } catch (err) {
      alert('Could not add email: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
      emailEl?.focus();
    }
  }

  async _deleteNotifEmail(id, rowEl) {
    try {
      await DB.notifications.delete(id);
      if (rowEl) {
        const list = rowEl.closest('.hv-pnotif-list');
        rowEl.remove();
        if (list && !list.querySelector('.hv-pnotif-row')) {
          list.innerHTML = '<p class="hv-notify-empty">None added yet.</p>';
        }
      }
    } catch (err) {
      alert('Could not remove: ' + err.message);
    }
  }

  async _addGuideToParticipant(pid) {
    const sel = this._content.querySelector(`.hv-guide-select[data-pid="${pid}"]`);
    const guideUserId = sel?.value;
    if (!guideUserId) { sel?.focus(); return; }
    const guide = (this._allGuides || []).find(g => String(g.id) === String(guideUserId));
    try {
      await DB.guides.assign(pid, guideUserId);
      const list = document.getElementById(`hv-guides-${pid}`);
      if (list) {
        list.querySelector('.hv-notify-empty')?.remove();
        list.insertAdjacentHTML('beforeend', `
          <span class="hv-guide-chip" data-pid="${_hvEsc(pid)}" data-gid="${_hvEsc(guideUserId)}">
            ${_hvEsc(guide?.email || '')}
            <button class="hv-guide-chip-del" data-pid="${_hvEsc(pid)}" data-gid="${_hvEsc(guideUserId)}" title="Remove access">&#10005;</button>
          </span>`);
      }
      sel.querySelector(`option[value="${guideUserId}"]`)?.remove();
      sel.value = '';
    } catch (err) {
      alert('Could not add guide: ' + err.message);
    }
  }

  async _removeGuideFromParticipant(pid, guideUserId) {
    try {
      await DB.guides.unassign(pid, guideUserId);
      const chip = this._content.querySelector(`.hv-guide-chip[data-pid="${pid}"][data-gid="${guideUserId}"]`);
      const list = chip?.closest('.hv-guide-chips');
      chip?.remove();
      if (list && !list.querySelector('.hv-guide-chip')) {
        list.innerHTML = '<p class="hv-notify-empty">No guides assigned.</p>';
      }
      const sel = this._content.querySelector(`.hv-guide-select[data-pid="${pid}"]`);
      const guide = (this._allGuides || []).find(g => String(g.id) === String(guideUserId));
      if (sel && guide) {
        sel.insertAdjacentHTML('beforeend', `<option value="${_hvEsc(guide.id)}">${_hvEsc(guide.email)}</option>`);
      }
    } catch (err) {
      alert('Could not remove guide: ' + err.message);
    }
  }

  async _confirmDeleteInstance(instanceId, instanceName) {
    if (!confirm(`Remove "${instanceName}" and all its data? This cannot be undone.`)) return;
    try {
      await DB.participantPinpoints.delete(instanceId);
      document.getElementById(`hv-inst-${instanceId}`)?.remove();
    } catch (err) {
      alert('Could not remove: ' + err.message);
    }
  }

}

function _hvEsc(str) {
  return (str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function _hvTypeLabelShort(mt) {
  return { frequency: 'Frequency', duration: 'Duration', latency: 'Latency', count_per_day: 'Count/Day' }[mt] || mt;
}
