/**
 * dashboard.js — Team ABA Dashboard
 * Manages domain switching, log entry panel, and entries list.
 * Depends on SCCChart (scc.js).
 */

class Dashboard {
  constructor() {
    this.domains = {
      movement:  { name: 'Movement Fluency',      points: [] },
      physical:  { name: 'Physical Load',          points: [] },
      decision:  { name: 'Decision Fluency',        points: [] },
      emotional: { name: 'Emotional Performance',  points: [] }
    };
    this.currentDomain = 'movement';

    this.chart = new SCCChart('scc-canvas', 'scc-tooltip');

    this._bindNav();
    this._bindLogPanel();
    this._bindExport();
    this._renderEntries();
  }

  // ── Domain switching ─────────────────────────────────────────────────────

  _bindNav() {
    document.querySelectorAll('.nav-item[data-domain]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        this._switchDomain(el.dataset.domain);
      });
    });
  }

  _switchDomain(key) {
    // Save current points
    this.domains[this.currentDomain].points = this.chart.getPoints();

    // Switch
    this.currentDomain = key;
    const domain = this.domains[key];

    // Update nav active state
    document.querySelectorAll('.nav-item[data-domain]').forEach(el => {
      el.classList.toggle('active', el.dataset.domain === key);
    });

    // Update title
    document.getElementById('domain-title').textContent = domain.name;

    // Restore points for this domain
    this.chart.points = [...domain.points];
    this.chart.draw();

    this._renderEntries();
  }

  // ── Log panel ────────────────────────────────────────────────────────────

  _bindLogPanel() {
    document.getElementById('btn-add').addEventListener('click', () => this._addEntry());
    document.getElementById('btn-undo').addEventListener('click', () => this._undo());
    document.getElementById('btn-clear').addEventListener('click', () => this._clearAll());

    // Allow Enter key to submit
    ['entry-day','entry-val','entry-note'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') this._addEntry();
      });
    });
  }

  _addEntry() {
    const type  = document.getElementById('entry-type').value;
    const day   = parseInt(document.getElementById('entry-day').value);
    const valRaw = document.getElementById('entry-val').value;
    const note  = document.getElementById('entry-note').value.trim();
    const fb    = document.getElementById('log-feedback');

    if (isNaN(day) || day < 0 || day > 140) {
      fb.textContent = 'Day must be 0–140.'; return;
    }
    if (type !== 'phase' && (!valRaw || isNaN(parseFloat(valRaw)) || parseFloat(valRaw) <= 0)) {
      fb.textContent = 'Enter a valid count per minute.'; return;
    }
    fb.textContent = '';

    const val = type === 'phase' ? null : parseFloat(valRaw);
    this.chart.addPoint({ type, day, val, note });

    // Clear inputs
    document.getElementById('entry-day').value  = '';
    document.getElementById('entry-val').value  = '';
    document.getElementById('entry-note').value = '';

    this._renderEntries();
    fb.textContent = 'Added.';
    setTimeout(() => fb.textContent = '', 1800);
  }

  _undo() {
    this.chart.undoLast();
    this._renderEntries();
  }

  _clearAll() {
    if (!confirm('Clear all data for this domain?')) return;
    this.chart.clearPoints();
    this._renderEntries();
  }

  // ── Entries list ─────────────────────────────────────────────────────────

  _renderEntries() {
    const el   = document.getElementById('entries-list');
    const pts  = this.chart.getPoints();

    if (!pts.length) {
      el.innerHTML = '<div class="no-entries">No entries yet.</div>';
      return;
    }

    const dispVal = v => {
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
        info = `<span class="entry-val">Day ${p.day} &middot; ${dispVal(p.val)}/min</span>` +
               (p.note ? ` <span class="entry-note">— ${p.note}</span>` : '');
      } else if (p.type === 'x') {
        icon = '<span class="entry-icon-x">&times;</span>';
        info = `<span class="entry-val">Day ${p.day} &middot; ${dispVal(p.val)}/min</span>` +
               (p.note ? ` <span class="entry-note">— ${p.note}</span>` : '');
      } else {
        icon = '<span class="entry-icon-phase"></span>';
        info = `<span class="entry-val">Phase change &middot; Day ${p.day}</span>` +
               (p.note ? ` <span class="entry-note">— ${p.note}</span>` : '');
      }

      return `<div class="entry-row">
        ${icon}
        <span class="entry-info">${info}</span>
        <button class="entry-del" onclick="window.dashboard.deleteEntry(${i})" title="Remove">&times;</button>
      </div>`;
    }).join('');
  }

  deleteEntry(index) {
    this.chart.removePoint(index);
    this._renderEntries();
  }

  // ── Export ───────────────────────────────────────────────────────────────

  _bindExport() {
    document.getElementById('btn-export').addEventListener('click', () => {
      this.chart.exportCSV(this.domains[this.currentDomain].name);
    });
  }
}
