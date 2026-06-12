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

    // Debounce timer for meta field saves
    this._metaTimer = null;

    this.chart = new SCCChart('scc-canvas', 'scc-tooltip');

    this._bindNav();
    this._bindMetaFields();
    this._bindLogPanel();
    this._bindExport();

    // Load initial domain
    this._loadDomain('movement');
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

      // Restore chart points
      this.chart.points = (points || []).map(p => ({
        id:   p.id,
        type: p.type,
        day:  p.day,
        val:  p.val,
        note: p.note,
        px:   p.type === 'phase' ? this.chart.xL(p.day) + this.chart.dayW * 0.5 : this.chart.xP(p.day),
        py:   p.type === 'phase' ? null : this.chart.yP(p.val)
      }));
      this.chart.draw();

      // Restore meta fields
      const metaFields = ['supervisor','adviser','manager','timer','counter','performer','age','label','counted','startDate'];
      metaFields.forEach(key => {
        const inputId = 'meta-' + key.toLowerCase().replace('startdate', 'startdate');
        const input = document.getElementById(inputId) || document.getElementById('meta-' + key);
        if (input) {
          input.value = (meta && meta[key]) ? meta[key] : '';
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
    document.getElementById('btn-undo').addEventListener('click', () => this._undo());
    document.getElementById('btn-clear').addEventListener('click', () => this._clearAll());

    ['entry-day','entry-val','entry-note'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') this._addEntry();
      });
    });

    // Hide count field when type is phase
    document.getElementById('entry-type').addEventListener('change', e => {
      const isPhase = e.target.value === 'phase';
      document.getElementById('entry-val').closest('.field-group').style.opacity = isPhase ? '0.4' : '1';
      document.getElementById('entry-val').disabled = isPhase;
    });
  }

  async _addEntry() {
    const type   = document.getElementById('entry-type').value;
    const day    = parseInt(document.getElementById('entry-day').value);
    const valRaw = document.getElementById('entry-val').value;
    const note   = document.getElementById('entry-note').value.trim();

    if (isNaN(day) || day < 0 || day > 140) {
      this._showFeedback('Day must be 0–140.', true); return;
    }
    if (type !== 'phase' && (!valRaw || isNaN(parseFloat(valRaw)) || parseFloat(valRaw) <= 0)) {
      this._showFeedback('Enter a valid count per minute.', true); return;
    }

    const val = type === 'phase' ? null : parseFloat(valRaw);

    this._setLoading(true);
    try {
      const saved = await DB.points.add({
        domain_slug: this.currentDomain,
        type, day, val, note
      });

      // Add to chart with the DB-assigned id
      this.chart.points.push({
        id:   saved.id,
        type, day, val, note,
        px: type === 'phase' ? this.chart.xL(day) + this.chart.dayW * 0.5 : this.chart.xP(day),
        py: type === 'phase' ? null : this.chart.yP(val)
      });
      this.chart.draw();

      document.getElementById('entry-day').value  = '';
      document.getElementById('entry-val').value  = '';
      document.getElementById('entry-note').value = '';

      this._renderEntries();
      this._showFeedback('Added.');
    } catch (err) {
      this._showFeedback('Save failed: ' + err.message, true);
      console.error(err);
    } finally {
      this._setLoading(false);
    }
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

    el.innerHTML = [...pts].reverse().map((p, ri) => {
      const i = pts.length - 1 - ri;
      let icon, info;
      if (p.type === 'dot') {
        icon = '<span class="entry-icon-dot"></span>';
        info = `<span class="entry-val">Day ${p.day} &middot; ${fmt(p.val)}/min</span>`
             + (p.note ? ` <span class="entry-note">— ${p.note}</span>` : '');
      } else if (p.type === 'x') {
        icon = '<span class="entry-icon-x">&times;</span>';
        info = `<span class="entry-val">Day ${p.day} &middot; ${fmt(p.val)}/min</span>`
             + (p.note ? ` <span class="entry-note">— ${p.note}</span>` : '');
      } else {
        icon = '<span class="entry-icon-phase"></span>';
        info = `<span class="entry-val">Phase change &middot; Day ${p.day}</span>`
             + (p.note ? ` <span class="entry-note">— ${p.note}</span>` : '');
      }
      return `<div class="entry-row">
        ${icon}
        <span class="entry-info">${info}</span>
        <button class="entry-del" onclick="window.dashboard.deleteEntry(${i})" title="Remove">&times;</button>
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
