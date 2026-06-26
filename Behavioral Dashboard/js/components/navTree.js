/**
 * navTree.js — Sidebar accordion navigation
 * Team → Participant → Behavior → Domain
 *
 * Staff/supervisors: full tree, all teams, can add/delete behaviors.
 * Participants (client role): own behaviors only, read-only.
 */

function _esc(str) {
  return (str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

class NavTree {
  constructor(onSelect) {
    this._onSelect     = onSelect; // (behaviorId, domainSlug, context) => void
    this._domains      = [];
    this._activeKey    = null;     // `${behaviorId}:${domainSlug}` for highlight
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
      this._domains = await DB.domains.getAll();
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
    const [teams, participants, behaviors] = await Promise.all([
      DB.teams.getAll(),
      DB.participants.getAll(),
      DB.behaviors.getAll()
    ]);

    const byTeam = {}, byPart = {};
    participants.forEach(p => {
      if (!byTeam[p.team_id]) byTeam[p.team_id] = [];
      byTeam[p.team_id].push(p);
    });
    behaviors.forEach(b => {
      if (!byPart[b.participant_id]) byPart[b.participant_id] = [];
      byPart[b.participant_id].push(b);
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

  _participantHTML(p, behaviors, teamName) {
    const bodyId = `tree-p-${p.id}`;
    const chevId = `tree-pc-${p.id}`;
    return `
      <div class="tree-participant">
        <div class="tree-hdr tree-participant-hdr js-toggle" data-target="${bodyId}" data-chev="${chevId}">
          <span class="tree-chev" id="${chevId}">&#9654;</span>
          <span class="tree-participant-name">${_esc(p.name)}</span>
        </div>
        <div class="tree-body hidden" id="${bodyId}">
          <div id="tree-behs-${p.id}">
            ${behaviors.map(b => this._behaviorHTML(b, p, teamName)).join('')}
          </div>
          <div class="tree-add-row">
            <input class="tree-add-input" type="text" placeholder="New behavior&#8230;"
                   data-pid="${_esc(p.id)}" data-tname="${_esc(teamName)}" data-pname="${_esc(p.name)}">
            <button class="tree-add-btn" data-pid="${_esc(p.id)}" data-tname="${_esc(teamName)}" data-pname="${_esc(p.name)}">+</button>
          </div>
        </div>
      </div>`;
  }

  _behaviorHTML(b, p, teamName) {
    const bodyId = `tree-b-${b.id}`;
    const chevId = `tree-bc-${b.id}`;
    const pName  = p.name || '';
    const tName  = teamName || '';
    const delBtn = DB.auth.isStaff()
      ? `<button class="tree-del js-del-beh" data-bid="${b.id}" data-bname="${_esc(b.name)}" title="Remove">&#10005;</button>`
      : '';
    const domainItems = this._domains.map(d => `
      <div class="tree-domain js-domain"
           id="tree-d-${b.id}-${d.slug}"
           data-bid="${b.id}"
           data-dslug="${d.slug}"
           data-tname="${_esc(tName)}"
           data-pname="${_esc(pName)}"
           data-bname="${_esc(b.name)}"
           data-dname="${_esc(d.name)}">
        ${_esc(d.name)}
      </div>`).join('');
    return `
      <div class="tree-behavior" id="tree-beh-${b.id}">
        <div class="tree-hdr tree-behavior-hdr js-toggle" data-target="${bodyId}" data-chev="${chevId}">
          <span class="tree-chev" id="${chevId}">&#9654;</span>
          <span class="tree-behavior-name">${_esc(b.name)}</span>
          ${delBtn}
        </div>
        <div class="tree-body hidden" id="${bodyId}">
          ${domainItems}
        </div>
      </div>`;
  }

  // ── Participant (client) tree ───────────────────────────────────────────
  // Flat layout: behavior name header + 4 domain buttons below, scrollable.

  async _buildParticipantTree() {
    const self = await DB.participants.getSelf();
    if (!self) {
      this._container.innerHTML =
        '<p class="tree-empty">No behaviors found.<br>Contact your coach or supervisor.</p>';
      return;
    }
    const behaviors = await DB.behaviors.get(self.id);
    const teamName  = (self.teams && self.teams.name) || '';

    if (!behaviors.length) {
      this._container.innerHTML = '<p class="tree-empty">No behaviors yet.</p>';
      this._bindEvents();
      return;
    }

    this._container.innerHTML = behaviors.map(b => `
      <div class="client-behavior-group">
        <div class="client-behavior-label">${_esc(b.name)}</div>
        ${this._domains.map(d => `
          <div class="tree-domain js-domain client-domain-btn"
               id="tree-d-${b.id}-${d.slug}"
               data-bid="${b.id}"
               data-dslug="${d.slug}"
               data-tname="${_esc(teamName)}"
               data-pname="${_esc(self.name)}"
               data-bname="${_esc(b.name)}"
               data-dname="${_esc(d.name)}">
            ${_esc(d.name)}
          </div>`).join('')}
      </div>`).join('');

    this._bindEvents();
  }

  // ── Events ─────────────────────────────────────────────────────────────

  _bindEvents() {
    if (this._eventsAdded) return;
    this._eventsAdded = true;

    this._container.addEventListener('click', e => {
      // Delete button must be checked before toggle since it's inside a .js-toggle
      const del = e.target.closest('.js-del-beh');
      if (del) {
        e.stopPropagation();
        this._confirmDelete(del.dataset.bid, del.dataset.bname);
        return;
      }

      const domain = e.target.closest('.js-domain');
      if (domain) {
        this._selectDomain(domain);
        return;
      }

      const toggle = e.target.closest('.js-toggle');
      if (toggle) {
        this._toggle(toggle);
        return;
      }

      const addBtn = e.target.closest('.tree-add-btn');
      if (addBtn) {
        const input = this._container.querySelector(
          `.tree-add-input[data-pid="${addBtn.dataset.pid}"]`
        );
        if (input) this._addBehavior(addBtn, input);
      }
    });

    this._container.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('.tree-add-input');
      if (!input) return;
      const btn = this._container.querySelector(
        `.tree-add-btn[data-pid="${input.dataset.pid}"]`
      );
      if (btn) this._addBehavior(btn, input);
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

  _selectDomain(el) {
    const { bid, dslug, tname, pname, bname, dname } = el.dataset;
    const key = `${bid}:${dslug}`;

    if (this._activeKey) {
      const prev = document.getElementById(
        `tree-d-${this._activeKey.replace(':', '-')}`
      );
      if (prev) prev.classList.remove('tree-domain--active');
    }

    el.classList.add('tree-domain--active');
    this._activeKey = key;
    this._onSelect(bid, dslug, {
      teamName:        tname,
      participantName: pname,
      behaviorName:    bname,
      domainName:      dname
    });
  }

  async _addBehavior(btn, input) {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const { pid, tname, pname } = btn.dataset;
    input.disabled = btn.disabled = true;
    try {
      const b = await DB.behaviors.add(pid, name);
      const container = document.getElementById(`tree-behs-${pid}`);
      if (container) {
        container.insertAdjacentHTML('beforeend',
          this._behaviorHTML(b, { id: pid, name: pname }, tname));
      }
      input.value = '';
    } catch (err) {
      alert('Could not add behavior: ' + err.message);
    } finally {
      input.disabled = btn.disabled = false;
      input.focus();
    }
  }

  async _confirmDelete(behaviorId, behaviorName) {
    if (!confirm(`Remove "${behaviorName}" and all its data? This cannot be undone.`)) return;
    try {
      await DB.behaviors.delete(behaviorId);
      document.getElementById(`tree-beh-${behaviorId}`)?.remove();
      if (this._activeKey && this._activeKey.startsWith(behaviorId + ':')) {
        this._activeKey = null;
        if (window.dashboard) window.dashboard._showBehaviorPrompt();
      }
    } catch (err) {
      alert('Could not remove behavior: ' + err.message);
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
