/**
 * pinpointsLibrary.js — Full-screen Pinpoints Library
 * Categories (open-ended, nestable folders) containing reusable Pinpoint
 * templates. Staff manage categories/pinpoints here, independent of any
 * specific athlete; athletes get pinpoints attached via Add Chart.
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
      const [categories, pinpoints] = await Promise.all([DB.categories.getAll(), DB.pinpoints.getAll()]);
      this._categories = categories || [];
      this._pinpoints   = pinpoints || [];
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
      (topLevel.length ? topLevel.map(c => this._categoryHTML(c, 0)).join('') : '<p class="hv-empty-msg">No categories yet.</p>') +
      this._addCategoryRowHTML();
  }

  _categoryHTML(cat, depth) {
    const children  = this._categories.filter(c => c.parent_id === cat.id).sort((a, b) => a.name.localeCompare(b.name));
    const pinpoints = this._pinpoints.filter(p => p.category_id === cat.id).sort((a, b) => a.name.localeCompare(b.name));
    const bodyId = `pl-body-${cat.id}`;
    const chevId = `pl-chev-${cat.id}`;
    const isEmpty = !pinpoints.length && !children.length;
    return `
      <div class="tree-team pl-category" style="margin-left:${depth * 20}px">
        <div class="tree-hdr js-toggle" data-target="${bodyId}" data-chev="${chevId}">
          <span class="tree-chev" id="${chevId}">&#9654;</span>
          <span class="tree-team-name">${_esc(cat.name)}</span>
          <button class="tree-del pl-del-cat" data-cid="${cat.id}" data-cname="${_esc(cat.name)}" data-empty="${isEmpty}" title="Delete category">&#10005;</button>
        </div>
        <div class="tree-body hidden" id="${bodyId}">
          ${pinpoints.map(p => this._pinpointRowHTML(p)).join('')}
          ${children.map(c => this._categoryHTML(c, depth + 1)).join('')}
          <div class="hv-add-row">
            <button class="hv-add-btn pl-add-pinpoint-btn" data-cid="${cat.id}">+ New Pinpoint</button>
          </div>
          <div class="hv-add-row">
            <input class="hv-add-input pl-subcat-input" type="text" placeholder="New subcategory&#8230;" data-cid="${cat.id}">
            <button class="hv-add-btn pl-add-subcat-btn" data-cid="${cat.id}">+</button>
          </div>
        </div>
      </div>`;
  }

  _pinpointRowHTML(p) {
    return `
      <div class="hv-behavior-row pl-pinpoint-row">
        <button class="hv-domain-btn pl-pinpoint-btn" data-pid="${p.id}">${_esc(p.name)}</button>
        <span class="pl-pinpoint-type-tag">${_esc(_plTypeLabelShort(p.measurement_type))}</span>
      </div>`;
  }

  _addCategoryRowHTML() {
    return `
      <div class="hv-add-row" style="margin-top:12px">
        <input class="hv-add-input pl-cat-input" type="text" placeholder="New top-level category&#8230;">
        <button class="hv-add-btn pl-add-cat-btn">+ Add Category</button>
      </div>`;
  }

  _applySearchFilter() {
    const q = (document.getElementById('pl-search')?.value || '').trim().toLowerCase();
    this._content.querySelectorAll('.pl-pinpoint-row').forEach(row => {
      const name  = row.querySelector('.pl-pinpoint-btn')?.textContent.toLowerCase() || '';
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
      const toggle = e.target.closest('.js-toggle');
      if (toggle) { this._toggle(toggle); return; }

      const delCat = e.target.closest('.pl-del-cat');
      if (delCat) { this._deleteCategory(delCat.dataset.cid, delCat.dataset.cname, delCat.dataset.empty === 'true'); return; }

      const addPinpoint = e.target.closest('.pl-add-pinpoint-btn');
      if (addPinpoint) {
        window.pinpointFormModal.show(null, addPinpoint.dataset.cid, () => this._load());
        return;
      }

      const pinpointBtn = e.target.closest('.pl-pinpoint-btn');
      if (pinpointBtn) {
        window.pinpointFormModal.show(pinpointBtn.dataset.pid, null, () => this._load());
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
      alert('Could not add category: ' + err.message);
    }
  }

  async _deleteCategory(id, name, isEmpty) {
    if (!isEmpty) {
      alert(`"${name}" still has pinpoints or subcategories inside it. Move or remove those first.`);
      return;
    }
    if (!confirm(`Delete the empty category "${name}"?`)) return;
    try {
      await DB.categories.delete(id);
      await this._load();
    } catch (err) {
      alert('Could not delete category: ' + err.message);
    }
  }
}

function _plTypeLabelShort(mt) {
  return { frequency: 'Frequency', duration: 'Duration', latency: 'Latency', count_per_day: 'Count/Day' }[mt] || mt;
}
