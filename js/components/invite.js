class InviteModal {
  constructor() {
    this.overlay = document.getElementById('invite-overlay');
    this._render();
  }

  show() {
    this.overlay.classList.remove('hidden');
    this._loadUsers();
  }

  hide() { this.overlay.classList.add('hidden'); }

  _render() {
    this.overlay.innerHTML = `
      <div class="login-card invite-card">
        <button class="invite-close" id="invite-close">&#x2715;</button>
        <div class="login-mode-label">Manage Users</div>

        <div class="manage-section-label">Current users</div>
        <div id="users-list" class="users-list"></div>

        <div class="manage-section-label" style="margin-top:18px">Add new user</div>

        <div class="login-field">
          <label for="invite-email">Email</label>
          <input type="email" id="invite-email" placeholder="user@example.com" autocomplete="off">
        </div>
        <div class="login-field">
          <label for="invite-role">Role</label>
          <select id="invite-role" class="invite-select">
            <option value="client">Client</option>
            <option value="staff">Staff</option>
            <option value="supervisor">Supervisor</option>
          </select>
        </div>
        <div class="login-field" id="invite-client-name-wrap">
          <label for="invite-client-name">Client name</label>
          <input type="text" id="invite-client-name" placeholder="e.g. John Smith">
        </div>

        <button class="login-btn" id="invite-submit">Add to list</button>
        <div class="login-feedback" id="invite-feedback"></div>
      </div>
    `;

    document.getElementById('invite-close').addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.hide(); });
    document.getElementById('invite-submit').addEventListener('click', () => this._addUser());
    document.getElementById('invite-email').addEventListener('keydown', e => { if (e.key === 'Enter') this._addUser(); });
    document.getElementById('invite-role').addEventListener('change', () => this._toggleClientName());
    this._toggleClientName();
  }

  async _loadUsers() {
    const listEl = document.getElementById('users-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="users-empty">Loading…</div>';
    try {
      const profiles = await DB.users.getAll();
      const me = DB.auth.getProfile();
      if (!profiles || !profiles.length) {
        listEl.innerHTML = '<div class="users-empty">No users found.</div>';
        return;
      }
      listEl.innerHTML = profiles.map(p => {
        const isSelf = p.id === me?.id;
        return `
          <div class="user-row">
            <div class="user-info">
              <div class="user-email" title="${p.email}">${p.email}</div>
              ${p.client_name ? `<div class="user-client-name">${p.client_name}</div>` : ''}
            </div>
            ${isSelf ? `
              <span class="role-tag">${p.role}</span>
              <span class="user-self">you</span>
            ` : `
              <select class="user-role-select" data-id="${p.id}">
                <option value="client"      ${p.role === 'client'      ? 'selected' : ''}>Client</option>
                <option value="staff"       ${p.role === 'staff'       ? 'selected' : ''}>Staff</option>
                <option value="supervisor"  ${p.role === 'supervisor'  ? 'selected' : ''}>Supervisor</option>
              </select>
              <button class="user-del-btn" data-id="${p.id}" data-email="${p.email}">Remove</button>
            `}
          </div>`;
      }).join('');

      listEl.querySelectorAll('.user-role-select').forEach(sel => {
        sel.addEventListener('change', () => this._changeRole(sel.dataset.id, sel.value, sel));
      });
      listEl.querySelectorAll('.user-del-btn').forEach(btn => {
        btn.addEventListener('click', () => this._removeUser(btn.dataset.id, btn.dataset.email));
      });
    } catch (err) {
      listEl.innerHTML = `<div class="users-empty" style="color:#cc3333">Could not load users: ${err.message}</div>`;
    }
  }

  async _changeRole(id, role, selectEl) {
    selectEl.disabled = true;
    try {
      await DB.users.update(id, { role });
    } catch (err) {
      this._feedback(`Role update failed: ${err.message}`, true);
      await this._loadUsers();
    } finally {
      selectEl.disabled = false;
    }
  }

  async _removeUser(id, email) {
    if (!confirm(`Remove ${email}?\n\nThey will lose access immediately and cannot sign up again unless re-added.`)) return;
    try {
      await DB.users.remove(id, email);
      await this._loadUsers();
      this._feedback(`${email} removed.`, false);
    } catch (err) {
      this._feedback(`Remove failed: ${err.message}`, true);
    }
  }

  _toggleClientName() {
    const role = document.getElementById('invite-role')?.value;
    const wrap = document.getElementById('invite-client-name-wrap');
    if (wrap) wrap.style.display = role === 'client' ? '' : 'none';
  }

  async _addUser() {
    const email      = document.getElementById('invite-email').value.trim();
    const role       = document.getElementById('invite-role').value;
    const clientName = role === 'client' ? document.getElementById('invite-client-name').value.trim() : null;
    const btn        = document.getElementById('invite-submit');

    this._feedback('', false);
    if (!email)                           { this._feedback('Enter an email address.', true); return; }
    if (role === 'client' && !clientName) { this._feedback('Enter a client name.', true); return; }

    btn.disabled = true;
    try {
      await DB.invites.add(email, role, clientName);
      this._feedback('Added — they can now create an account.', false);
      document.getElementById('invite-email').value = '';
      if (clientName !== null) document.getElementById('invite-client-name').value = '';
      await this._loadUsers();
    } catch (err) {
      const msg = /duplicate|already exists|unique/i.test(err.message)
        ? 'That email is already on the list.'
        : err.message;
      this._feedback(msg, true);
    } finally {
      btn.disabled = false;
    }
  }

  _feedback(msg, isError) {
    const fb = document.getElementById('invite-feedback');
    if (!fb) return;
    fb.textContent = msg;
    fb.className = 'login-feedback ' + (isError ? 'error' : 'success');
  }
}
