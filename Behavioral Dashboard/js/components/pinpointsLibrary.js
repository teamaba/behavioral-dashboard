/**
 * pinpointsLibrary.js — Full-screen Pinpoints Library
 * Categories (open-ended, nestable folders) containing reusable Pinpoint
 * templates. Staff manage categories/pinpoints here, independent of any
 * specific participant; participants get pinpoints attached via Add Chart.
 */

class PinpointsLibrary {
  constructor() {
    this._el      = document.getElementById('pinpoints-library-view');
    this._content = document.getElementById('pl-content');
    this._categories = [];
    this._pinpoints   = [];
    this._eventsBound = false;
    document.getElementById('pl-search')?.addEventListener('input', () => this._applySearchFilter());
    document.getElementById('pl-back')?.addEventListener('click', () => this.hide());
  }

  async show() {
    window.hierarchyView?.hide();
    document.getElementById('app-root').style.display = 'none';
    this._el.classList.remove('hidden');
    this._content.innerHTML = '<p class="hv-loading">Loading&#8230;</p>';
    await this._load();
  }

  hide() {
    this._el.classList.add('hidden');
    window.showHierarchyView?.();
  }

  async _load() {
    try {
      const [categories, pinpoints, allInstances, lastDates] = await Promise.all([
        DB.categories.getAll(), DB.pinpoints.getAll(),
        DB.participantPinpoints.getAllForLibrary(), DB.points.getLastDatesByInstance(),
      ]);
      this._categories = categories || [];
      this._pinpoints   = pinpoints || [];

      // Group assigned instances by the library pinpoint they came from, so
      // each row can show its client list + last-used date without a
      // separate request per pinpoint.
      this._clientsByPinpoint = {};
      (allInstances || []).forEach(inst => {
        if (!inst.pinpoint_id) return;
        (this._clientsByPinpoint[inst.pinpoint_id] ||= []).push(inst);
      });
      this._lastUsedByPinpoint = {};
      Object.entries(this._clientsByPinpoint).forEach(([pinpointId, instances]) => {
        const dates = instances.map(i => lastDates[i.id]).filter(Boolean).sort();
        this._lastUsedByPinpoint[pinpointId] = dates.length ? dates[dates.length - 1] : null;
      });

      // Resolve creator emails in bulk. Staff (non-supervisor) only get
      // their own profile back here per RLS — creators other than
      // themselves will show as "Unknown", same as in View Pinpoint.
      try {
        const profiles = (await DB.users.getAll()) || [];
        this._creatorEmailById = {};
        profiles.forEach(pr => { this._creatorEmailById[pr.id] = pr.email; });
      } catch (_) { this._creatorEmailById = {}; }

      this._render();
      this._bindEvents();
    } catch (err) {
      this._content.innerHTML = `<p class="hv-error">Could not load the library: ${_esc(err.message)}</p>`;
      console.error('[PinpointsLibrary]', err);
    }
  }

  _render() {
    const topLevel = this._categories.filter(c => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
    this._content.innerHTML =
      (topLevel.length ? topLevel.map(c => this._categoryHTML(c, 0)).join('') : '<p class="hv-empty-msg">No folders yet.</p>') +
      this._addCategoryRowHTML();
  }

  _categoryHTML(cat, depth) {
    const children  = this._categories.filter(c => c.parent_id === cat.id).sort((a, b) => a.name.localeCompare(b.name));
    const pinpoints = this._pinpoints.filter(p => p.category_id === cat.id).sort((a, b) => a.name.localeCompare(b.name));
    const bodyId = `pl-body-${cat.id}`;
    const chevId = `pl-chev-${cat.id}`;
    const isEmpty = !pinpoints.length && !children.length;
    // The 4 seeded "Game Speed" folders are the only ones with a slug
    // (DB.categories.add never sets one for user-created folders) — protected
    // from deletion here in the UI, and at the DB level via a delete trigger.
    const isProtected = !!cat.slug;
    const delBtn = isProtected
      ? `<button class="tree-del pl-del-cat" disabled title="Game Speed folders can't be deleted">&#10005;</button>`
      : `<button class="tree-del pl-del-cat" data-cid="${cat.id}" data-cname="${_esc(cat.name)}" data-empty="${isEmpty}" title="Delete folder">&#10005;</button>`;
    return `
      <div class="tree-team pl-category" style="margin-left:${depth * 20}px">
        <div class="tree-hdr js-toggle" data-target="${bodyId}" data-chev="${chevId}">
          <span class="tree-chev" id="${chevId}">&#9654;</span>
          <span class="pl-category-name">${_esc(cat.name)}</span>
          ${delBtn}
        </div>
        <div class="tree-body hidden" id="${bodyId}">
          ${pinpoints.length ? this._pinpointTableHTML(pinpoints) : ''}
          ${children.map(c => this._categoryHTML(c, depth + 1)).join('')}
          <div class="hv-add-row">
            <button class="hv-add-btn pl-add-pinpoint-btn" data-cid="${cat.id}">+ New Pinpoint</button>
          </div>
          <div class="hv-add-row">
            <input class="hv-add-input pl-subcat-input" type="text" placeholder="New subfolder&#8230;" data-cid="${cat.id}">
            <button class="hv-add-btn pl-add-subcat-btn" data-cid="${cat.id}">+</button>
          </div>
        </div>
      </div>`;
  }

  _pinpointTableHTML(pinpoints) {
    return `
      <table class="pl-pinpoint-table pl-pinpoint-table--wide">
        <thead>
          <tr><th>Pinpoint</th><th>Type</th><th>Created By</th><th>Created</th><th>Last Used</th><th>Clients</th></tr>
        </thead>
        <tbody>
          ${pinpoints.map(p => this._pinpointRowHTML(p)).join('')}
        </tbody>
      </table>`;
  }

  _plFmtDate(iso) {
    return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  }

  _pinpointRowHTML(p) {
    const clients     = this._clientsByPinpoint?.[p.id] || [];
    const clientNames = clients.map(c => c.participants?.name).filter(Boolean);
    const lastUsed     = this._lastUsedByPinpoint?.[p.id];
    const creatorEmail = (p.created_by && this._creatorEmailById?.[p.created_by]) || 'Unknown';
    return `
      <tr class="pl-pinpoint-row" data-pid="${p.id}">
        <td class="pl-pinpoint-name">${_esc(p.name)}</td>
        <td><span class="pl-pinpoint-type-tag">${_esc(_plTypeLabelShort(p.measurement_type))}</span></td>
        <td>${_esc(creatorEmail)}</td>
        <td>${this._plFmtDate(p.created_at)}</td>
        <td>${lastUsed ? this._plFmtDate(lastUsed) : 'Never'}</td>
        <td title="${_esc(clientNames.join(', '))}">${clientNames.length}</td>
      </tr>`;
  }

  _addCategoryRowHTML() {
    return `
      <div class="hv-add-row" style="margin-top:12px">
        <input class="hv-add-input pl-cat-input" type="text" placeholder="New folder&#8230;">
        <button class="hv-add-btn pl-add-cat-btn">+ Add Folder</button>
      </div>`;
  }

  _applySearchFilter() {
    const q = (document.getElementById('pl-search')?.value || '').trim().toLowerCase();
    this._content.querySelectorAll('.pl-pinpoint-row').forEach(row => {
      const name  = row.querySelector('.pl-pinpoint-name')?.textContent.toLowerCase() || '';
      const match = !q || name.includes(q);
      row.style.display = match ? '' : 'none';
      if (match && q) {
        let el = row.closest('.tree-body');
        while (el) {
          el.classList.remove('hidden');
          const chev = document.getElementById(el.id.replace('pl-body-', 'pl-chev-'));
          if (chev) chev.innerHTML = '&#9660;';
          el = el.parentElement?.closest('.tree-body');
        }
      }
    });
  }

  _bindEvents() {
    if (this._eventsBound) return;
    this._eventsBound = true;

    this._content.addEventListener('click', e => {
      // Delete button must be checked before toggle since it's nested inside
      // the .js-toggle header row — otherwise the toggle swallows the click.
      const delCat = e.target.closest('.pl-del-cat');
      if (delCat) {
        e.stopPropagation();
        this._deleteCategory(delCat.dataset.cid, delCat.dataset.cname, delCat.dataset.empty === 'true');
        return;
      }

      const toggle = e.target.closest('.js-toggle');
      if (toggle) { this._toggle(toggle); return; }

      const addPinpoint = e.target.closest('.pl-add-pinpoint-btn');
      if (addPinpoint) {
        window.pinpointFormModal.show(null, addPinpoint.dataset.cid, () => this._load());
        return;
      }

      const pinpointRow = e.target.closest('.pl-pinpoint-row');
      if (pinpointRow) {
        window.pinpointFormModal.show(pinpointRow.dataset.pid, null, () => this._load());
        return;
      }

      const addSubcatBtn = e.target.closest('.pl-add-subcat-btn');
      if (addSubcatBtn) {
        const input = this._content.querySelector(`.pl-subcat-input[data-cid="${addSubcatBtn.dataset.cid}"]`);
        this._addCategory(input, addSubcatBtn.dataset.cid);
        return;
      }

      if (e.target.classList.contains('pl-add-cat-btn')) {
        const input = this._content.querySelector('.pl-cat-input');
        this._addCategory(input, null);
      }
    });

    this._content.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (e.target.classList.contains('pl-subcat-input')) {
        this._addCategory(e.target, e.target.dataset.cid);
      } else if (e.target.classList.contains('pl-cat-input')) {
        this._addCategory(e.target, null);
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

  async _addCategory(input, parentId) {
    const name = input?.value.trim();
    if (!name) { input?.focus(); return; }
    try {
      await DB.categories.add(name, parentId);
      await this._load();
    } catch (err) {
      alert('Could not add folder: ' + err.message);
    }
  }

  async _deleteCategory(id, name, isEmpty) {
    if (!isEmpty) {
      alert(`"${name}" still has pinpoints or subfolders inside it. Move or remove those first.`);
      return;
    }
    if (!confirm(`Delete the empty folder "${name}"? This cannot be undone.`)) return;
    try {
      await DB.categories.delete(id);
      await this._load();
    } catch (err) {
      alert('Could not delete folder: ' + err.message);
    }
  }
}

function _plTypeLabelShort(mt) {
  return { frequency: 'Frequency', duration: 'Duration', latency: 'Latency', count_per_day: 'Count/Day' }[mt] || mt;
}
