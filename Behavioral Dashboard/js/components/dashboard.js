/**
 * dashboard.js — Team ABA Dashboard
 * Manages domain switching, log entry panel, and entries list.
 * Depends on SCCChart (scc.js) and DB (db.js).
 */

class Dashboard {
  constructor() {
    this.domains = {
      movement:  'Movement Fluency',
      physical:  'Physical Load',
      decision:  'Decision Fluency',
      emotional: 'Emotional Performance'
    };
    this.currentDomain = 'movement';
    this._domainAim    = {};
    this._editingIndex = null;

    // Debounce timer for meta field saves
    this._metaTimer = null;

    this.chart = new SCCChart('scc-canvas', 'scc-tooltip');
    this.isReadOnly = !DB.auth.isStaff();

    this._bindNav();
    this._bindMetaFields();
    this._bindLogPanel();
    this._bindChartType();
    this._bindAggregation();
    this._bindAim();
    this._bindExport();
    this._bindDemo();
    this._applyAccessControl();

    // Load initial domain
    this._loadDomain('movement');
  }

  // ── Access control ───────────────────────────────────────────────────────

  _applyAccessControl() {
    if (!this.isReadOnly) return;

    const logSection  = document.querySelector('.log-section');
    const metaSection = document.querySelector('.meta-section');
    if (logSection)  logSection.style.display  = 'none';
    if (metaSection) metaSection.style.display = 'none';
  }

  // ── Chart type ───────────────────────────────────────────────────────────

  _bindChartType() {
    const sel     = document.getElementById('chart-type');
    const aggCtrl = document.getElementById('aggregation-control');
    if (!sel) return;

    const update = () => {
      const type = sel.value;
      this.chart.setChartType(type);
      if (aggCtrl) {
        const showAgg = type === 'weekly' || type === 'monthly';
        aggCtrl.classList.toggle('hidden', !showAgg);
      }
    };

    sel.addEventListener('change', update);
    update(); // apply initial state
  }

  _bindAggregation() {
    const sel = document.getElementById('aggregation-method');
    if (!sel) return;
    sel.addEventListener('change', () => {
      this.chart.setAggregation(sel.value);
    });
  }

  _bindAim() {
    const lowEl  = document.getElementById('aim-low');
    const highEl = document.getElementById('aim-high');
    if (!lowEl || !highEl) return;
    const update = () => {
      const lo = parseFloat(lowEl.value);
      const hi = parseFloat(highEl.value);
      this.chart.setAimRange(isNaN(lo) ? null : lo, isNaN(hi) ? null : hi);
    };
    lowEl.addEventListener('input', update);
    highEl.addEventListener('input', update);
  }

  // ── Domain switching ─────────────────────────────────────────────────────

  _bindNav() {
    document.querySelectorAll('.nav-item[data-domain]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        if (el.dataset.domain !== this.currentDomain) {
          this._loadDomain(el.dataset.domain);
        }
      });
    });
  }

  async _loadDomain(slug) {
    // Save aim values for the domain we're leaving
    const aimLowEl  = document.getElementById('aim-low');
    const aimHighEl = document.getElementById('aim-high');
    this._domainAim[this.currentDomain] = {
      low:  aimLowEl  ? aimLowEl.value  : '',
      high: aimHighEl ? aimHighEl.value : '',
    };

    this._setLoading(true);
    this.currentDomain = slug;

    // Update nav
    document.querySelectorAll('.nav-item[data-domain]').forEach(el => {
      el.classList.toggle('active', el.dataset.domain === slug);
    });

    // Update title
    document.getElementById('domain-title').textContent = this.domains[slug];

    try {
      // Load points and meta in parallel
      const [points, meta] = await Promise.all([
        DB.points.get(slug),
        DB.meta.get(slug)
      ]);

      // Restore aim values for this domain
      const aim = this._domainAim[slug] || { low: '', high: '' };
      if (aimLowEl)  aimLowEl.value  = aim.low;
      if (aimHighEl) aimHighEl.value = aim.high;
      const lo = parseFloat(aim.low);
      const hi = parseFloat(aim.high);
      this.chart.aimLow  = isNaN(lo) ? null : lo;
      this.chart.aimHigh = isNaN(hi) ? null : hi;

      // Restore chart points
      this.chart.points = (points || []).map(p => ({
        id:   p.id,
        type: p.type,
        day:  p.day,
        val:  p.val,
        note: p.note,
        floor: p.floor || null,
        px:   this.chart._isLineType(p.type) ? this.chart.xL(p.day) : this.chart.xP(p.day),
        py:   this.chart._isLineType(p.type) ? null : this.chart.yP(p.val)
      }));
      this.chart.draw();

      // Restore meta fields
      const metaFields = ['startDate','organization','supervisor','counter','charter','environment','timer','correct','incorrect','neutral','acceltarget','deceltarget'];
      metaFields.forEach(key => {
        const input = document.getElementById('meta-' + key.toLowerCase());
        if (input) {
          input.value = (meta && meta[key] != null) ? meta[key] : '';
          this.chart.setMeta(key, input.value);
        }
      });

      this._renderEntries();
    } catch (err) {
      this._showFeedback('Error loading data: ' + err.message, true);
      console.error(err);
    } finally {
      this._setLoading(false);
    }
  }

  // ── Chart metadata ────────────────────────────────────────────────────────

  _bindMetaFields() {
    document.querySelectorAll('[data-meta]').forEach(input => {
      input.addEventListener('input', () => {
        // Update canvas immediately
        this.chart.setMeta(input.dataset.meta, input.value.trim());
        // Debounce DB save — wait 800ms after last keystroke
        clearTimeout(this._metaTimer);
        this._metaTimer = setTimeout(() => this._saveMeta(), 800);
      });
    });
  }

  async _saveMeta() {
    const fields = {};
    document.querySelectorAll('[data-meta]').forEach(input => {
      fields[input.dataset.meta] = input.value.trim();
    });
    try {
      await DB.meta.upsert(this.currentDomain, fields);
    } catch (err) {
      console.error('Meta save failed:', err);
    }
  }

  // ── Log panel ─────────────────────────────────────────────────────────────

  _bindLogPanel() {
    document.getElementById('btn-add').addEventListener('click', () => this._addEntry());
    document.getElementById('btn-cancel-edit').addEventListener('click', () => this._exitEditMode());
    document.getElementById('btn-undo').addEventListener('click', () => this._undo());
    document.getElementById('btn-clear').addEventListener('click', () => this._clearAll());

    // Default date to today
    const entryDate = document.getElementById('entry-date');
    if (entryDate && !entryDate.value) {
      entryDate.value = new Date().toISOString().slice(0, 10);
    }

    ['entry-date','entry-events','entry-floor','entry-note'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') this._addEntry();
      });
    });

    // Hide measurement fields when type is a line (phase or intervention)
    document.getElementById('entry-type').addEventListener('change', e => {
      const isLine = e.target.value === 'phase' || e.target.value === 'intervention';
      ['entry-events','entry-floor'].forEach(id => {
        const el = document.getElementById(id);
        el.closest('.field-group').style.opacity = isLine ? '0.4' : '1';
        el.disabled = isLine;
      });
    });

    // Chart scroll controls
    document.getElementById('btn-scroll-left').addEventListener('click', () => {
      this.chart.scrollBy(-this.chart._scrollStep());
    });
    document.getElementById('btn-scroll-right').addEventListener('click', () => {
      this.chart.scrollBy(this.chart._scrollStep());
    });
    document.getElementById('btn-scroll-home').addEventListener('click', () => {
      this.chart.scrollHome();
    });
  }

  _readLogForm() {
    const type    = document.getElementById('entry-type').value;
    const dateStr = document.getElementById('entry-date').value;
    const note    = document.getElementById('entry-note').value.trim();
    if (!dateStr) { this._showFeedback('Select a date.', true); return null; }
    if (!this.chart.meta.startDate) {
      this._showFeedback('Set Day 0 date in Chart Info first.', true); return null;
    }
    let val = null, floor = null;
    if (!this.chart._isLineType(type)) {
      const events   = parseInt(document.getElementById('entry-events').value, 10);
      const floorSec = this._parseFloor(document.getElementById('entry-floor').value.trim());
      if (!events || events < 1 || isNaN(events)) {
        this._showFeedback('Enter a valid event count.', true); return null;
      }
      if (!floorSec || floorSec <= 0) {
        this._showFeedback('Enter floor time (e.g. 0:30 or 1:00:00).', true); return null;
      }
      val   = events * 60 / floorSec;
      floor = floorSec;
    }
    const day = Math.round(
      (new Date(dateStr) - new Date(this.chart.meta.startDate)) / 86400000
    );
    return { type, day, val, note, floor };
  }

  async _addEntry() {
    if (this._editingIndex !== null) { await this._saveEdit(); return; }

    const entry = this._readLogForm();
    if (!entry) return;
    const { type, day, val, note, floor } = entry;

    this._setLoading(true);
    try {
      const saved = await DB.points.add({
        domain_slug: this.currentDomain,
        type, day, val, note, floor
      });
      this.chart.points.push({
        id: saved.id, type, day, val, note, floor,
        px: this.chart._isLineType(type) ? this.chart.xL(day) : this.chart.xP(day),
        py: this.chart._isLineType(type) ? null : this.chart.yP(val)
      });
      this.chart.draw();
      this.chart.scrollToDay(day);
      document.getElementById('entry-date').value   = new Date().toISOString().slice(0, 10);
      document.getElementById('entry-events').value = '';
      document.getElementById('entry-floor').value  = '';
      document.getElementById('entry-note').value   = '';
      this._renderEntries();
      this._showFeedback('Added.');
    } catch (err) {
      this._showFeedback('Save failed: ' + err.message, true);
      console.error(err);
    } finally {
      this._setLoading(false);
    }
  }

  async _saveEdit() {
    const entry = this._readLogForm();
    if (!entry) return;
    const { type, day, val, note, floor } = entry;
    const pts = this.chart.getPoints();
    const old = pts[this._editingIndex];
    this._setLoading(true);
    try {
      if (old.id) await DB.points.delete(old.id);
      this.chart.removePoint(this._editingIndex);
      const saved = await DB.points.add({
        domain_slug: this.currentDomain,
        type, day, val, note, floor
      });
      this.chart.points.push({
        id: saved.id, type, day, val, note, floor,
        px: this.chart._isLineType(type) ? this.chart.xL(day) : this.chart.xP(day),
        py: this.chart._isLineType(type) ? null : this.chart.yP(val)
      });
      this.chart.draw();
      this.chart.scrollToDay(day);
      this._exitEditMode();
      this._renderEntries();
      this._showFeedback('Updated.');
    } catch (err) {
      this._showFeedback('Save failed: ' + err.message, true);
      console.error(err);
    } finally {
      this._setLoading(false);
    }
  }

  editEntry(index) {
    const pts = this.chart.getPoints();
    const p   = pts[index];
    this._editingIndex = index;

    document.getElementById('entry-type').value = p.type;
    document.getElementById('entry-type').dispatchEvent(new Event('change'));

    if (this.chart.meta.startDate) {
      const dt = new Date(this.chart.meta.startDate);
      dt.setUTCDate(dt.getUTCDate() + p.day);
      document.getElementById('entry-date').value = dt.toISOString().slice(0, 10);
    }

    if (!this.chart._isLineType(p.type) && p.floor) {
      document.getElementById('entry-events').value = Math.round(p.val * p.floor / 60);
      document.getElementById('entry-floor').value  = this._formatFloor(p.floor);
    } else {
      document.getElementById('entry-events').value = '';
      document.getElementById('entry-floor').value  = '';
    }
    document.getElementById('entry-note').value = p.note || '';

    document.getElementById('btn-add').textContent = 'Save changes';
    document.getElementById('btn-cancel-edit').classList.remove('hidden');
    document.getElementById('btn-undo').classList.add('hidden');
    document.getElementById('btn-clear').classList.add('hidden');
    document.getElementById('btn-demo').classList.add('hidden');
    document.querySelector('.log-section').classList.add('log-section--editing');
    document.querySelector('.log-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  _exitEditMode() {
    this._editingIndex = null;
    document.getElementById('btn-add').textContent = 'Add to chart';
    document.getElementById('btn-cancel-edit').classList.add('hidden');
    document.getElementById('btn-undo').classList.remove('hidden');
    document.getElementById('btn-clear').classList.remove('hidden');
    document.getElementById('btn-demo').classList.remove('hidden');
    document.querySelector('.log-section').classList.remove('log-section--editing');
    document.getElementById('entry-type').value = 'dot';
    document.getElementById('entry-type').dispatchEvent(new Event('change'));
    document.getElementById('entry-date').value   = new Date().toISOString().slice(0, 10);
    document.getElementById('entry-events').value = '';
    document.getElementById('entry-floor').value  = '';
    document.getElementById('entry-note').value   = '';
  }

  _parseFloor(str) {
    if (!str) return null;
    const parts = str.split(':').map(s => parseInt(s, 10));
    if (parts.some(isNaN) || parts.length < 1 || parts.length > 3) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  _formatFloor(sec) {
    if (!sec) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  async _undo() {
    const pts = this.chart.getPoints();
    if (!pts.length) return;
    const last = pts[pts.length - 1];
    this._setLoading(true);
    try {
      if (last.id) await DB.points.delete(last.id);
      this.chart.undoLast();
      this._renderEntries();
    } catch (err) {
      this._showFeedback('Undo failed: ' + err.message, true);
    } finally {
      this._setLoading(false);
    }
  }

  async _clearAll() {
    if (!confirm('Clear all data for this domain?')) return;
    this._setLoading(true);
    try {
      await DB.points.clear(this.currentDomain);
      this.chart.clearPoints();
      this._renderEntries();
    } catch (err) {
      this._showFeedback('Clear failed: ' + err.message, true);
    } finally {
      this._setLoading(false);
    }
  }

  // ── Entries list ──────────────────────────────────────────────────────────

  _renderEntries() {
    const el  = document.getElementById('entries-list');
    const pts = this.chart.getPoints();

    if (!pts.length) {
      el.innerHTML = '<div class="no-entries">No entries yet.</div>';
      return;
    }

    const fmt = v => {
      if (v == null) return '—';
      return v >= 100 ? Math.round(v).toString()
           : v >= 10  ? v.toFixed(1)
           : v >= 1   ? v.toFixed(2)
           : v >= 0.1 ? v.toFixed(3)
           : v.toFixed(4);
    };

    // Convert day offset to a readable date string if startDate is set
    const sd = this.chart.meta.startDate ? new Date(this.chart.meta.startDate) : null;
    const dayLabel = day => {
      if (!sd) return `Day ${day}`;
      const dt = new Date(sd);
      dt.setUTCDate(dt.getUTCDate() + day);
      const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(dt.getUTCDate()).padStart(2, '0');
      const yy = String(dt.getUTCFullYear()).slice(-2);
      return `${mm}/${dd}/${yy}`;
    };

    el.innerHTML = [...pts].reverse().map((p, ri) => {
      const i = pts.length - 1 - ri;
      let icon, info;
      const rateDetail = p.floor
        ? `${Math.round(p.val * p.floor / 60)} evt / ${this._formatFloor(p.floor)} → ${fmt(p.val)}/min`
        : `${fmt(p.val)}/min`;
      if (p.type === 'dot') {
        icon = '<span class="entry-icon-dot"></span>';
        info = `<span class="entry-val">${dayLabel(p.day)} &middot; ${rateDetail}</span>`
             + (p.note ? ` <span class="entry-note">— ${p.note}</span>` : '');
      } else if (p.type === 'x') {
        icon = '<span class="entry-icon-x">&times;</span>';
        info = `<span class="entry-val">${dayLabel(p.day)} &middot; ${rateDetail}</span>`
             + (p.note ? ` <span class="entry-note">— ${p.note}</span>` : '');
      } else if (p.type === 'phase') {
        icon = '<span class="entry-icon-phase"></span>';
        info = `<span class="entry-val">Phase change &middot; ${dayLabel(p.day)}</span>`
             + (p.note ? ` <span class="entry-note">— ${p.note}</span>` : '');
      } else {
        icon = '<span class="entry-icon-intervention"></span>';
        info = `<span class="entry-val">Intervention &middot; ${dayLabel(p.day)}</span>`
             + (p.note ? ` <span class="entry-note">— ${p.note}</span>` : '');
      }
      return `<div class="entry-row">
        ${icon}
        <span class="entry-info">${info}</span>
        ${this.isReadOnly ? '' : `
          <button class="entry-edit" onclick="window.dashboard.editEntry(${i})" title="Edit">&#9998;</button>
          <button class="entry-del" onclick="window.dashboard.deleteEntry(${i})" title="Delete">&times;</button>
        `}
      </div>`;
    }).join('');
  }

  async deleteEntry(index) {
    const pts  = this.chart.getPoints();
    const point = pts[index];
    this._setLoading(true);
    try {
      if (point.id) await DB.points.delete(point.id);
      this.chart.removePoint(index);
      this._renderEntries();
    } catch (err) {
      this._showFeedback('Delete failed: ' + err.message, true);
    } finally {
      this._setLoading(false);
    }
  }

  // ── Demo data ─────────────────────────────────────────────────────────────

  _bindDemo() {
    const btn = document.getElementById('btn-demo');
    if (!btn) return;
    btn.addEventListener('click', () => this._loadDemo());
  }

  _loadDemo() {
    if (this.chart.points.length && !confirm('Replace current data with demo data?')) return;

    // Basketball dribble-control drill — consistent 10 s timing window throughout.
    // Floor band sits at 6–12/min (60/10 to 120/10). Event counts vary to produce
    // the same trajectory: acceleration in makes, deceleration in errors, with a
    // phase-change dip and post-intervention recovery.
    // val = events × 60 / 10 = events × 6 per minute
    const F = 10;

    // [day, events, note]
    const dotRaw = [
      [7,  2, 'Baseline session'],
      [10, 2, ''],
      [14, 2, ''],
      [18, 2, ''],
      [21, 3, ''],
      [25, 3, ''],
      [28, 4, ''],
      // phase at 28 — defender tanks makes
      [35, 2, 'First day with defender'],
      [39, 3, ''],
      [42, 3, ''],
      [46, 4, ''],
      // intervention at 49 — footwork drill accelerates recovery
      [53, 5, 'Footwork clicking'],
      [56, 6, ''],
      [60, 7, ''],
      [63, 8, ''],
      [67, 9, ''],
      [70, 10, ''],
    ];
    const errRaw = [
      [7,  5, ''],
      [14, 4, ''],
      [21, 4, ''],
      [25, 3, ''],
      [28, 3, ''],
      // defender spikes errors
      [35, 5, 'Defender caused turnovers'],
      [42, 4, ''],
      [49, 3, ''],
      [56, 3, ''],
      [63, 2, ''],
      [70, 2, ''],
    ];

    const mk = (type, day, val, note = '', floor = null) => ({
      id: null, type, day, val, note, floor,
      px: this.chart._isLineType(type) ? this.chart.xL(day) : this.chart.xP(day),
      py: this.chart._isLineType(type) ? null : this.chart.yP(val)
    });

    this.chart.points = [
      ...dotRaw.map(([day, ev, note]) => mk('dot', day, ev * 60 / F, note, F)),
      ...errRaw.map(([day, ev, note]) => mk('x',   day, ev * 60 / F, note, F)),
      mk('phase',        28, null, 'Defender introduced'),
      mk('intervention', 49, null, 'Footwork drill added'),
    ];

    const demoMeta = {
      startDate:    '2025-01-01',
      organization: 'Team ABA',
      supervisor:   'Coach D.',
      environment:  'Practice Gym',
      correct:      'Makes',
      incorrect:    'Misses',
      acceltarget:  '1.5',
      deceltarget:  '1.3',
    };
    Object.entries(demoMeta).forEach(([key, val]) => {
      const el = document.getElementById('meta-' + key.toLowerCase());
      if (el) el.value = val;
      if (key in this.chart.meta) this.chart.meta[key] = val;
    });

    const aimLowEl  = document.getElementById('aim-low');
    const aimHighEl = document.getElementById('aim-high');
    if (aimLowEl)  { aimLowEl.value  = '80';  this.chart.aimLow  = 80;  }
    if (aimHighEl) { aimHighEl.value = '120'; this.chart.aimHigh = 120; }

    this.chart.draw();
    this._renderEntries();
    this._showFeedback('Demo loaded — not saved to database.');
  }

  // ── Export ────────────────────────────────────────────────────────────────

  _bindExport() {
    document.getElementById('btn-export').addEventListener('click', () => {
      this.chart.exportCSV(this.domains[this.currentDomain]);
    });
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  _setLoading(on) {
    document.getElementById('btn-add').disabled = on;
    document.body.style.cursor = on ? 'wait' : '';
  }

  _showFeedback(msg, isError = false) {
    const el = document.getElementById('log-feedback');
    el.textContent = msg;
    el.style.color = isError ? '#cc3333' : '#0099cc';
    clearTimeout(this._fbTimer);
    this._fbTimer = setTimeout(() => el.textContent = '', 2500);
  }
}
