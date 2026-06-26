/**
 * hierarchyView.js — Full-screen hierarchy home page
 * Teams → Participants → Behaviors → Domain buttons (sorted by last access)
 *
 * Supervisors: add teams, add participants, manage notification list.
 * Staff:       add behaviors to existing participants.
 * Clients:     own behaviors only, read-only.
 */

class HierarchyView {
  constructor(onSelect) {
    this._onSelect     = onSelect;
    this._el           = document.getElementById('hierarchy-view');
    this._content      = document.getElementById('hv-content');
    this._domains      = [];
    this._eventsBound  = false;
  }

  async show() {
    this._el.classList.remove('hidden');
    this._content.innerHTML = '<p class="hv-loading">Loading&#8230;</p>';
    try {
      this._domains = await DB.domains.getAll();
      if (DB.auth.isStaff()) {
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

  _getAccess(behaviorId, domainSlug) {
    const v = localStorage.getItem(`bd_access:${behaviorId}:${domainSlug}`);
    return v ? parseInt(v, 10) : 0;
  }

  recordAccess(behaviorId, domainSlug) {
    localStorage.setItem(`bd_access:${behaviorId}:${domainSlug}`, Date.now().toString());
  }

  _sortedDomains(behaviorId) {
    return [...this._domains].sort((a, b) =>
      this._getAccess(behaviorId, b.slug) - this._getAccess(behaviorId, a.slug)
    );
  }

  // ── Staff rendering ─────────────────────────────────────────────────────

  async _renderStaff() {
    const [teams, participants, behaviors] = await Promise.all([
      DB.teams.getAll(), DB.participants.getAll(), DB.behaviors.getAll()
    ]);
    let allNotifEmails = [];
    try { allNotifEmails = (await DB.notifications.getAll()) || []; } catch (_) { /* table not yet created */ }

    const byTeam = {}, byPart = {}, notifByPart = {};
    participants.forEach(p => {
      if (!byTeam[p.team_id]) byTeam[p.team_id] = [];
      byTeam[p.team_id].push(p);
    });
    behaviors.forEach(b => {
      if (!byPart[b.participant_id]) byPart[b.participant_id] = [];
      byPart[b.participant_id].push(b);
    });
    allNotifEmails.forEach(n => {
      if (!notifByPart[n.participant_id]) notifByPart[n.participant_id] = [];
      notifByPart[n.participant_id].push(n);
    });

    if (!teams.length) {
      this._content.innerHTML = `
        <div class="hv-empty">
          <p class="hv-empty-msg">No teams yet.</p>
          ${DB.auth.isSupervisor() ? this._addTeamHTML() : ''}
          <button class="hv-demo-btn" id="hv-btn-demo">Load demo hierarchy</button>
        </div>`;
      document.getElementById('hv-btn-demo')?.addEventListener('click', () => this._loadDemo());
      this._bindEvents();
      return;
    }

    this._notifByPart = notifByPart;
    this._content.innerHTML =
      teams.map(team => this._teamHTML(team, byTeam[team.id] || [], byPart, notifByPart)).join('') +
      this._supervisorPanelHTML() +
      `<div class="hv-footer-actions">
        <button class="hv-demo-btn-sm" id="hv-btn-demo">Load demo hierarchy</button>
      </div>`;

    document.getElementById('hv-btn-demo')?.addEventListener('click', () => this._loadDemo());
    this._bindEvents();
  }

  // ── HTML builders ────────────────────────────────────────────────────────

  _teamHTML(team, participants, byPart, notifByPart = {}) {
    const cards = participants.map(p =>
      this._participantCard(p, byPart[p.id] || [], team.name, notifByPart[p.id] || [])
    ).join('');
    const addPart = DB.auth.isSupervisor() ? `
      <div class="hv-add-participant-row">
        <input class="hv-add-input hv-add-part-name" type="text"
               placeholder="Participant name&#8230;"
               data-tid="${_hvEsc(team.id)}" data-tname="${_hvEsc(team.name)}">
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

  _participantCard(p, behaviors, teamName, notifEmails = []) {
    const behaviorRows = behaviors.map(b => this._behaviorRow(b, p, teamName)).join('');
    const notifRows = notifEmails.map(n => `
      <div class="hv-pnotif-row" data-nid="${n.id}">
        <span class="hv-pnotif-email">${_hvEsc(n.email)}</span>
        ${n.label ? `<span class="hv-notify-label-tag">${_hvEsc(n.label)}</span>` : ''}
        <button class="hv-notify-del" data-nid="${n.id}" title="Remove">&#10005;</button>
      </div>`).join('');
    return `
      <div class="hv-card">
        <div class="hv-card-name">${_hvEsc(p.name)}</div>
        <div class="hv-client-email-row">
          <label class="hv-client-email-label">Client login emails</label>
          <input class="hv-client-email-input" type="email"
                 placeholder="Not set"
                 value="${_hvEsc(p.email || '')}"
                 data-pid="${_hvEsc(p.id)}"
                 data-orig="${_hvEsc(p.email || '')}">
        </div>
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
        </div>
        <div class="hv-behaviors" id="hv-behs-${p.id}">
          ${behaviorRows}
          ${!behaviors.length ? '<p class="hv-no-behaviors">No behaviors yet.</p>' : ''}
        </div>
        <div class="hv-add-row">
          <input class="hv-add-input" type="text" placeholder="Add behavior&#8230;"
                 data-pid="${_hvEsc(p.id)}" data-tname="${_hvEsc(teamName)}" data-pname="${_hvEsc(p.name)}">
          <button class="hv-add-btn"
                  data-pid="${_hvEsc(p.id)}" data-tname="${_hvEsc(teamName)}" data-pname="${_hvEsc(p.name)}">+</button>
        </div>
      </div>`;
  }

  _behaviorRow(b, p, teamName) {
    const sorted     = this._sortedDomains(b.id);
    const mostRecent = sorted[0] && this._getAccess(b.id, sorted[0].slug) > 0 ? sorted[0].slug : null;
    const domainBtns = sorted.map(d => {
      const isRecent = d.slug === mostRecent;
      return `<button class="hv-domain-btn${isRecent ? ' hv-domain-btn--recent' : ''}"
                      data-bid="${b.id}" data-dslug="${d.slug}" data-partid="${_hvEsc(p.id)}"
                      data-tname="${_hvEsc(teamName)}" data-pname="${_hvEsc(p.name)}"
                      data-bname="${_hvEsc(b.name)}" data-dname="${_hvEsc(d.name)}">${_hvEsc(d.name)}</button>`;
    }).join('');
    const delBtn = DB.auth.isStaff()
      ? `<button class="hv-del-beh" data-bid="${b.id}" data-bname="${_hvEsc(b.name)}" title="Remove behavior">&#10005;</button>`
      : '';
    return `
      <div class="hv-behavior-row" id="hv-beh-${b.id}">
        <div class="hv-behavior-label">
          <span class="hv-behavior-name">${_hvEsc(b.name)}</span>
          ${delBtn}
        </div>
        <div class="hv-domain-chips">${domainBtns}</div>
      </div>`;
  }

  _addTeamHTML() {
    return `
      <div class="hv-add-team-row">
        <input class="hv-add-input" type="text" id="hv-add-team-input" placeholder="Team name&#8230;">
        <button class="hv-add-btn" id="hv-add-team-btn">+ Add team</button>
      </div>`;
  }

  _supervisorPanelHTML() {
    if (!DB.auth.isStaff()) return '';
    return `
      <div class="hv-supervisor-panel">
        ${DB.auth.isSupervisor() ? `<section class="hv-sup-section">
          <h3 class="hv-sup-title">Add team</h3>
          ${this._addTeamHTML()}
        </section>` : ''}
        <section class="hv-sup-section hv-demo-tools">
          <h3 class="hv-sup-title">Demo tools</h3>
          <p class="hv-sup-desc">Shortcuts for demonstrating features — not visible to clients.</p>
          <div class="hv-demo-tool-row">
            <button class="hv-demo-tool-btn" id="hv-demo-timeout">Simulate session timeout warning</button>
            <span class="hv-demo-tool-desc">Shows the inactivity countdown modal immediately.</span>
          </div>
          <div class="hv-demo-tool-row">
            <input class="hv-add-input" type="email" id="hv-demo-email-addr" placeholder="Send test to this address…">
            <button class="hv-demo-tool-btn" id="hv-demo-email">Send test goal email</button>
          </div>
          <p class="hv-demo-email-status hidden" id="hv-demo-email-status"></p>
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
        '<p class="hv-empty-msg">No behaviors found. Contact your coach or supervisor.</p>';
      return;
    }
    const behaviors = await DB.behaviors.get(self.id);
    const teamName  = (self.teams && self.teams.name) || '';
    const rows = behaviors.map(b => this._behaviorRow(b, self, teamName)).join('');
    this._content.innerHTML = `
      <section class="hv-team">
        <div class="hv-cards">
          <div class="hv-card">
            <div class="hv-card-name">${_hvEsc(self.name)}</div>
            <div class="hv-behaviors">
              ${rows || '<p class="hv-no-behaviors">No behaviors yet.</p>'}
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
      const domainBtn = e.target.closest('.hv-domain-btn');
      if (domainBtn) { this._selectDomain(domainBtn); return; }

      const delBeh = e.target.closest('.hv-del-beh');
      if (delBeh) { this._confirmDeleteBehavior(delBeh.dataset.bid, delBeh.dataset.bname); return; }

      // Add behavior — button has data-pid
      const addBehBtn = e.target.closest('.hv-add-btn[data-pid]');
      if (addBehBtn) {
        const input = this._content.querySelector(`.hv-add-input[data-pid="${addBehBtn.dataset.pid}"]`);
        if (input) this._addBehavior(addBehBtn, input);
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
      if (e.target.id === 'hv-demo-timeout') { window.inactivityMonitor?.triggerWarning(30 * 1000); return; }
      if (e.target.id === 'hv-demo-email')   { this._sendTestEmail(); return; }

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

      // Behavior input (must come after notif check — shares hv-add-input + data-pid)
      const behInput = e.target.closest('.hv-add-input[data-pid]');
      if (behInput) {
        const btn = this._content.querySelector(`.hv-add-btn[data-pid="${behInput.dataset.pid}"]`);
        if (btn) this._addBehavior(btn, behInput);
        return;
      }

      // Participant name input — Enter to add
      const partInput = e.target.closest('.hv-add-part-name');
      if (partInput) {
        const btn = this._content.querySelector(`.hv-add-part-btn[data-tid="${partInput.dataset.tid}"]`);
        if (btn) this._addParticipant(btn, partInput);
        return;
      }

      if (e.target.id === 'hv-add-team-input') { this._addTeam(); return; }
    });
  }

  _selectDomain(el) {
    const { bid, dslug, partid, tname, pname, bname, dname } = el.dataset;
    this.recordAccess(bid, dslug);
    this._onSelect(bid, dslug, { teamName: tname, participantName: pname, behaviorName: bname, domainName: dname, participantId: partid });
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

  async _addBehavior(btn, input) {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const { pid, tname, pname } = btn.dataset;
    input.disabled = btn.disabled = true;
    try {
      const b = await DB.behaviors.add(pid, name);
      const container = document.getElementById(`hv-behs-${pid}`);
      if (container) {
        container.querySelector('.hv-no-behaviors')?.remove();
        container.insertAdjacentHTML('beforeend', this._behaviorRow(b, { id: pid, name: pname }, tname));
      }
      input.value = '';
    } catch (err) {
      alert('Could not add behavior: ' + err.message);
    } finally {
      input.disabled = btn.disabled = false;
      input.focus();
    }
  }

  async _addParticipant(btn, nameEl) {
    const name = nameEl?.value.trim();
    if (!name) { nameEl?.focus(); return; }
    const { tid, tname } = btn.dataset;
    nameEl.disabled = btn.disabled = true;
    try {
      const p = await DB.participants.add(tid, name, null);
      const container = document.getElementById(`hv-cards-${tid}`);
      if (container) {
        container.querySelector('.hv-no-participants')?.remove();
        container.insertAdjacentHTML('beforeend', this._participantCard(p, [], tname));
      }
      nameEl.value = '';
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

  async _sendTestEmail() {
    const btn     = document.getElementById('hv-demo-email');
    const addrEl  = document.getElementById('hv-demo-email-addr');
    const status  = document.getElementById('hv-demo-email-status');
    const email   = addrEl?.value.trim();

    if (!email) { addrEl?.focus(); return; }
    if (btn) btn.disabled = true;

    const _show = (msg, isError) => {
      if (!status) return;
      status.textContent = msg;
      status.className = 'hv-demo-email-status ' + (isError ? 'hv-demo-email-status--error' : 'hv-demo-email-status--ok');
      status.classList.remove('hidden');
    };

    try {
      await DB.functions.invoke('send-goal-email', {
        to_emails:        [email],
        participant_name: 'Demo Client',
        team_name:        'Demo Team',
        domain:           'Demo Behavior · Demo Domain',
        goal_desc:        'Rate: ≥ 10 /min',
        actual_value:     '12.4 /min',
        goal_note:        'This is a test email from Team ABA demo tools.'
      });
      _show(`Test email sent to ${email}.`, false);
    } catch (err) {
      _show('Send failed: ' + err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async _confirmDeleteBehavior(behaviorId, behaviorName) {
    if (!confirm(`Remove "${behaviorName}" and all its data? This cannot be undone.`)) return;
    try {
      await DB.behaviors.delete(behaviorId);
      document.getElementById(`hv-beh-${behaviorId}`)?.remove();
    } catch (err) {
      alert('Could not remove: ' + err.message);
    }
  }

  async _loadDemo() {
    const teams = await DB.teams.getAll();
    if (teams.some(t => t.name === 'Orlando Magic' || t.name === 'Sacramento Kings')) {
      alert('Demo teams are already loaded.');
      return;
    }
    const btn = document.getElementById('hv-btn-demo');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      await DB.teams.seedDemo();
      await this.show();
    } catch (err) {
      alert('Demo load failed: ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Load demo hierarchy'; }
    }
  }
}

function _hvEsc(str) {
  return (str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
