/**
 * navTree.js — Sidebar accordion navigation
 * Team → Participant → Pinpoint Chart Instance
 *
 * Staff/supervisors: full tree, all teams, can add/remove pinpoint charts.
 * Participants (client role): own pinpoint charts only, read-only.
 */

function _esc(str) {
  return (str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

class NavTree {
  constructor(onSelect) {
    this._onSelect     = onSelect; // (instanceId, context) => void
    this._activeKey    = null;     // instanceId, for highlight
    this._eventsAdded  = false;

    // Create the container if it doesn't exist (client sidebar starts empty)
    let container = document.getElementById('sidebar-tree');
    if (!container) {
      container = document.createElement('div');
      container.id = 'sidebar-tree';
      document.querySelector('.sidebar-nav')?.appendChild(container);
    }
    this._container = container;
    this._init();
  }

  async _init() {
    this._container.innerHTML = '<p class="tree-loading">Loading&#8230;</p>';
    try {
      if (DB.auth.isStaff()) {
        await this._buildStaffTree();
      } else {
        await this._buildParticipantTree();
      }
    } catch (err) {
      this._container.innerHTML = `<p class="tree-error">Navigation error: ${_esc(err.message)}</p>`;
      console.error('[NavTree]', err);
    }
  }

  // ── Staff tree ──────────────────────────────────────────────────────────

  async _buildStaffTree() {
    const [teams, participants, instances] = await Promise.all([
      DB.teams.getAll(),
      DB.participants.getAll(),
      DB.participantPinpoints.getAll()
    ]);

    const byTeam = {}, byPart = {};
    participants.forEach(p => {
      if (!byTeam[p.team_id]) byTeam[p.team_id] = [];
      byTeam[p.team_id].push(p);
    });
    instances.forEach(i => {
      if (!byPart[i.participant_id]) byPart[i.participant_id] = [];
      byPart[i.participant_id].push(i);
    });

    const html = teams.length
      ? teams.map(t => this._teamHTML(t, byTeam[t.id] || [], byPart)).join('')
      : '<p class="tree-empty">No teams yet.</p>';

    this._container.innerHTML = html;
    this._appendDemoBtn();
    this._bindEvents();
  }

  _teamHTML(team, participants, byPart) {
    const bodyId = `tree-t-${team.id}`;
    const chevId = `tree-tc-${team.id}`;
    return `
      <div class="tree-team">
        <div class="tree-hdr js-toggle" data-target="${bodyId}" data-chev="${chevId}">
          <span class="tree-chev" id="${chevId}">&#9654;</span>
          <span class="tree-team-name">${_esc(team.name)}</span>
        </div>
        <div class="tree-body hidden" id="${bodyId}">
          ${participants.map(p => this._participantHTML(p, byPart[p.id] || [], team.name)).join('')}
        </div>
      </div>`;
  }

  _participantHTML(p, instances, teamName) {
    const bodyId = `tree-p-${p.id}`;
    const chevId = `tree-pc-${p.id}`;
    const addRow = DB.auth.isStaff() ? `
          <div class="tree-add-row">
            <button class="tree-add-btn tree-add-chart-btn" data-pid="${_esc(p.id)}" data-tname="${_esc(teamName)}" data-pname="${_esc(p.name)}">+ Add Chart</button>
          </div>` : '';
    return `
      <div class="tree-participant">
        <div class="tree-hdr tree-participant-hdr js-toggle" data-target="${bodyId}" data-chev="${chevId}">
          <span class="tree-chev" id="${chevId}">&#9654;</span>
          <span class="tree-participant-name">${_esc(p.name)}</span>
        </div>
        <div class="tree-body hidden" id="${bodyId}">
          <div id="tree-insts-${p.id}">
            ${instances.map(inst => this._instanceHTML(inst, p, teamName)).join('')}
          </div>
          ${addRow}
        </div>
      </div>`;
  }

  _instanceHTML(inst, p, teamName) {
    const pName  = p.name || '';
    const tName  = teamName || '';
    const delBtn = DB.auth.isStaff()
      ? `<button class="tree-del js-del-inst" data-iid="${inst.id}" data-iname="${_esc(inst.name)}" title="Remove">&#10005;</button>`
      : '';
    return `
      <div class="tree-domain js-domain"
           id="tree-i-${inst.id}"
           data-iid="${inst.id}"
           data-tname="${_esc(tName)}"
           data-pname="${_esc(pName)}"
           data-iname="${_esc(inst.name)}">
        <span class="tree-domain-name">${_esc(inst.name)}</span>
        ${delBtn}
      </div>`;
  }

  // ── Participant (client) tree ───────────────────────────────────────────
  // Flat layout: every assigned pinpoint chart is its own top-level row.

  async _buildParticipantTree() {
    const self = await DB.participants.getSelf();
    if (!self) {
      this._container.innerHTML =
        '<p class="tree-empty">No pinpoints found.<br>Contact your coach or supervisor.</p>';
      return;
    }
    const instances = await DB.participantPinpoints.get(self.id);
    const teamName  = (self.teams && self.teams.name) || '';

    if (!instances.length) {
      this._container.innerHTML = '<p class="tree-empty">No pinpoints yet.</p>';
      this._bindEvents();
      return;
    }

    this._container.innerHTML = instances.map(inst => this._instanceHTML(inst, self, teamName)).join('');
    this._bindEvents();
  }

  // ── Events ─────────────────────────────────────────────────────────────

  _bindEvents() {
    if (this._eventsAdded) return;
    this._eventsAdded = true;

    this._container.addEventListener('click', e => {
      // Delete button must be checked before select since it's inside the leaf row
      const del = e.target.closest('.js-del-inst');
      if (del) {
        e.stopPropagation();
        this._confirmDelete(del.dataset.iid, del.dataset.iname);
        return;
      }

      const inst = e.target.closest('.js-domain');
      if (inst) {
        this._selectInstance(inst);
        return;
      }

      const toggle = e.target.closest('.js-toggle');
      if (toggle) {
        this._toggle(toggle);
        return;
      }

      const addBtn = e.target.closest('.tree-add-chart-btn');
      if (addBtn) {
        this._openAddChart(addBtn.dataset.pid, addBtn.dataset.tname, addBtn.dataset.pname);
      }
    });
  }

  _toggle(el) {
    const body = document.getElementById(el.dataset.target);
    const chev = document.getElementById(el.dataset.chev);
    if (!body) return;
    const closing = !body.classList.contains('hidden');
    body.classList.toggle('hidden');
    if (chev) chev.innerHTML = closing ? '&#9654;' : '&#9660;';
  }

  _selectInstance(el) {
    const { iid, tname, pname, iname } = el.dataset;

    if (this._activeKey) {
      const prev = document.getElementById(`tree-i-${this._activeKey}`);
      if (prev) prev.classList.remove('tree-domain--active');
    }

    el.classList.add('tree-domain--active');
    this._activeKey = iid;
    this._onSelect(iid, {
      teamName:        tname,
      participantName: pname,
      instanceName:    iname
    });
  }

  _openAddChart(pid, tname, pname) {
    if (window.addChartModal) {
      window.addChartModal.show({ id: pid, name: pname }, tname);
    } else {
      alert('Add Chart is not available yet.');
    }
  }

  async _confirmDelete(instanceId, instanceName) {
    if (!confirm(`Remove "${instanceName}" and all its data? This cannot be undone.`)) return;
    try {
      await DB.participantPinpoints.delete(instanceId);
      document.getElementById(`tree-i-${instanceId}`)?.remove();
      if (this._activeKey === instanceId) {
        this._activeKey = null;
        if (window.dashboard) window.dashboard._showBehaviorPrompt();
      }
    } catch (err) {
      alert('Could not remove pinpoint: ' + err.message);
    }
  }

  // ── Demo hierarchy button ───────────────────────────────────────────────

  _appendDemoBtn() {
    const div = document.createElement('div');
    div.className = 'tree-demo-wrap';
    div.innerHTML = '<button class="tree-demo-btn" id="btn-demo-hierarchy">Load demo hierarchy</button>';
    this._container.appendChild(div);
    document.getElementById('btn-demo-hierarchy').addEventListener('click', () => this._loadDemo());
  }

  async _loadDemo() {
    const teams = await DB.teams.getAll();
    if (teams.some(t => t.name === 'Orlando Magic' || t.name === 'Sacramento Kings')) {
      alert('Demo teams are already loaded. Expand a team in the sidebar to explore.');
      return;
    }
    const btn = document.getElementById('btn-demo-hierarchy');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      await DB.teams.seedDemo();
      this._eventsAdded = false; // allow re-binding after rebuild
      await this._buildStaffTree();
    } catch (err) {
      alert('Demo load failed: ' + err.message);
      console.error('[NavTree demo]', err);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Load demo hierarchy'; }
    }
  }
}
