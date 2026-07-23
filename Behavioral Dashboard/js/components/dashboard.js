/**
 * dashboard.js — Team ABA Dashboard
 * Manages domain switching, log entry panel, and entries list.
 * Depends on SCCChart (scc.js) and DB (db.js).
 */

class Dashboard {
  constructor() {
    this.currentInstanceId = null;
    this.currentInstance   = null; // full participant_pinpoints row (measurement_type, view, point_display, ...)
    this._editingIndex     = null;
    this._context          = null;

    // Debounce timer for meta field saves
    this._metaTimer = null;

    this.chart = new SCCChart('scc-canvas', 'scc-tooltip');
    this.isReadOnly = !DB.auth.isStaff();
    this.isStaff    = DB.auth.isStaff();

    this.goalsManager = new GoalsManager();
    if (this.isStaff) {
      document.getElementById('review-section').classList.remove('hidden');
    }
    this.chart.afterDraw = () => {
      if (this.isStaff) this._updateProgramReview();
    };

    this._bindMetaFields();
    this._bindMarkerPopup();
    this._bindLogPanel();
    this._bindChartType();
    this._bindAggregation();
    this._bindAim();
    this._applyAccessControl();
    this._showBehaviorPrompt();
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
        const showAgg = type === 'weekly' || type === 'monthly' || type === 'yearly' || type === 'count_per_day';
        aggCtrl.classList.toggle('hidden', !showAgg);
      }
      const floorGroup = document.getElementById('entry-floor')?.closest('.field-group');
      if (floorGroup) floorGroup.style.display = type === 'count_per_day' ? 'none' : '';
      const isCpd = type === 'count_per_day';
      const aimLowLabel  = document.querySelector('label[for="aim-low"]');
      const aimHighLabel = document.querySelector('label[for="aim-high"]');
      if (aimLowLabel)  aimLowLabel.textContent  = isCpd ? 'Aim low (count/day)'  : 'Aim low (rate/min)';
      if (aimHighLabel) aimHighLabel.textContent = isCpd ? 'Aim high (count/day)' : 'Aim high (rate/min)';
      if (this.currentInstanceId) this._saveInstanceDisplay();
    };

    sel.addEventListener('change', update);
    update(); // apply initial state
  }

  _bindAggregation() {
    const sel = document.getElementById('aggregation-method');
    if (!sel) return;
    sel.addEventListener('change', () => {
      this.chart.setAggregation(sel.value);
      if (this.currentInstanceId) this._saveInstanceDisplay();
    });
  }

  // Persists the currently-selected view + point display back onto the
  // instance so it's sticky next time this pinpoint is opened.
  async _saveInstanceDisplay() {
    const view         = document.getElementById('chart-type')?.value;
    const point_display = document.getElementById('aggregation-method')?.value;
    if (!view) return;
    try {
      await DB.participantPinpoints.update(this.currentInstanceId, { view, point_display });
      if (this.currentInstance) {
        this.currentInstance.view = view;
        this.currentInstance.point_display = point_display;
      }
    } catch (err) {
      console.error('[Dashboard] Could not save display preference:', err);
    }
  }

  _bindAim() {
    const lowEl  = document.getElementById('aim-low');
    const highEl = document.getElementById('aim-high');
    if (!lowEl || !highEl) return;
    const update = () => {
      const lo = parseFloat(lowEl.value);
      const hi = parseFloat(highEl.value);
      this.chart.setAimRange(isNaN(lo) ? null : lo, isNaN(hi) ? null : hi);
      clearTimeout(this._metaTimer);
      this._metaTimer = setTimeout(() => this._saveMeta(), 800);
    };
    lowEl.addEventListener('input', update);
    highEl.addEventListener('input', update);
  }

  // ── Domain switching ─────────────────────────────────────────────────────

  // Called by NavTree/HierarchyView when the user selects a pinpoint chart instance
  async activate(instanceId, context) {
    // Hide prompt and show chart sections immediately (no async gap)
    this._hideBehaviorPrompt();
    this._setLoading(true);

    const aimLowEl  = document.getElementById('aim-low');
    const aimHighEl = document.getElementById('aim-high');

    this.currentInstanceId = instanceId;
    this._context           = context;

    try {
      const instance = await DB.participantPinpoints.getOne(instanceId);
      if (!instance) { this._setLoading(false); return; }
      this.currentInstance = instance;

      // Update breadcrumb
      const parts = [context.participantName, instance.name].filter(Boolean);
      const titleEl = document.getElementById('domain-title');
      if (titleEl) titleEl.textContent = parts.join(' › ');

      // Apply the instance's locked measurement type + sticky view/point display
      this.chart.setMeasurementType(instance.measurement_type);
      const chartTypeSel = document.getElementById('chart-type');
      const aggSel        = document.getElementById('aggregation-method');
      if (chartTypeSel) chartTypeSel.value = instance.view || 'daily';
      if (aggSel)         aggSel.value        = instance.point_display || 'geometric_mean';
      this.chart.setChartType(instance.view || 'daily');
      this.chart.setAggregation(instance.point_display || 'geometric_mean');
      const aggCtrl = document.getElementById('aggregation-control');
      if (aggCtrl) {
        const showAgg = ['weekly', 'monthly', 'yearly', 'count_per_day'].includes(instance.view);
        aggCtrl.classList.toggle('hidden', !showAgg);
      }
      this._applyEntryTypeMode(document.getElementById('entry-type').value);

      const [points, meta] = await Promise.all([
        DB.points.get(instanceId),
        DB.meta.get(instanceId)
      ]);

      // Restore aim values from DB
      const aimLo = meta?.aim_low  != null ? parseFloat(meta.aim_low)  : NaN;
      const aimHi = meta?.aim_high != null ? parseFloat(meta.aim_high) : NaN;
      if (aimLowEl)  aimLowEl.value  = isNaN(aimLo) ? '' : aimLo;
      if (aimHighEl) aimHighEl.value = isNaN(aimHi) ? '' : aimHi;
      this.chart.aimLow  = isNaN(aimLo) ? null : aimLo;
      this.chart.aimHigh = isNaN(aimHi) ? null : aimHi;

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
      const metaFields = ['startDate','organization','supervisor','counter','charter','environment','timer','correct','incorrect','neutral','acceltarget','deceltarget','goal','dotColor','dotShape','xColor','xShape'];
      metaFields.forEach(key => {
        const input = document.getElementById('meta-' + key.toLowerCase());
        if (input) {
          let saved = meta && meta[key] != null && meta[key] !== '' ? meta[key] : null;
          // First time this instance's chart_meta is created, the log/legend
          // fields prefill from the pinpoint the instance was copied from.
          if (saved == null) {
            if (key === 'correct')   saved = instance.correct_label   || null;
            if (key === 'incorrect') saved = instance.incorrect_label || null;
            if (key === 'neutral')   saved = instance.neutral_label   || null;
          }
          input.value = saved ?? '';
          this.chart.setMeta(key, input.value);
        }
      });

      // Default Day 0 to today if not already set
      const startDateEl = document.getElementById('meta-startdate');
      if (startDateEl && !startDateEl.value) {
        const today = new Date().toISOString().slice(0, 10);
        startDateEl.value = today;
        this.chart.setMeta('startDate', today);
      }

      this._renderEntries();
      this.goalsManager?.setInstance(instanceId, instance.name, context.participantId, context.participantName, context.teamName);
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
    if (!this.currentInstanceId) return;
    const fields = {};
    document.querySelectorAll('[data-meta]').forEach(input => {
      fields[input.dataset.meta] = input.value.trim() || null;
    });
    const lo = parseFloat(document.getElementById('aim-low')?.value);
    const hi = parseFloat(document.getElementById('aim-high')?.value);
    fields['aim_low']  = isNaN(lo) ? null : lo;
    fields['aim_high'] = isNaN(hi) ? null : hi;
    try {
      await DB.meta.upsert(this.currentInstanceId, fields);
    } catch (err) {
      this._showFeedback('Meta save failed: ' + err.message, true);
    }
  }

  _updateProgramReview() {
    if (!this.isStaff) return;

    const el  = id => document.getElementById(id);
    const set = (id, val) => { const e = el(id); if (e) e.textContent = val; };

    // Legend: displayed points and level method
    const dpMap  = { timings: 'Individual', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', count_per_day: 'Daily Total' };
    const lvlMap = {
      geometric_mean: 'Geometric Mean', median: 'Median', first: 'First', last: 'Last',
      stacked: 'Stacked', summative: 'Summative', best: 'Best', worst: 'Worst'
    };
    set('review-displayed-points', dpMap[this.chart.chartType] || '—');
    set('review-level-method', lvlMap[this.chart.aggregation] || 'Geometric Mean');

    // Marker symbols + labels
    const dotSym   = { circle: '●', square: '■', triangle: '▲', diamond: '◆', slash: '/', backslash: '\\' }[this.chart.meta.dotShape || 'circle'] || '●';
    const xSym     = { x: '×', plus: '+', dash: '—', opencircle: '○' }[this.chart.meta.xShape || 'x'] || '×';
    const dotColor = this.chart.meta.dotColor || '#009933';
    const xColor   = this.chart.meta.xColor   || '#cc0000';

    const dotSymEl = el('review-dot-sym');
    if (dotSymEl) { dotSymEl.textContent = dotSym; dotSymEl.style.color = dotColor; }
    const xSymEl = el('review-x-sym');
    if (xSymEl)   { xSymEl.textContent   = xSym;   xSymEl.style.color   = xColor; }

    set('review-correct-label',   this.chart.meta.correct   || 'correct responses');
    set('review-incorrect-label', this.chart.meta.incorrect || 'incorrect responses');

    // Stat dot colors
    [1, 2, 3].forEach(i => {
      const d = el(`review-stat-dot-${i}`);
      if (d) { d.textContent = dotSym; d.style.color = dotColor; }
    });

    // Computed stats
    const stats = this.chart.getStats();
    set('review-condition', stats.condition || 'N/A');

    const fmt = v => v >= 100 ? Math.round(v).toString()
      : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3);

    const fmtCel = v => {
      if (!v) return '—';
      if (Math.abs(v - 1) < 0.005) return '× 1.00';
      return v > 1 ? `× ${fmt(v)}` : `÷ ${fmt(1 / v)}`;
    };

    set('review-level',      stats.level      ? fmt(stats.level)             : '—');
    set('review-celeration', fmtCel(stats.dotCeleration));
    set('review-bounce',     stats.dotBounce  ? `× ${fmt(stats.dotBounce)}` : '—');
    set('review-imp-index',  fmtCel(stats.impIndex));
  }

  _bindMarkerPopup() {
    const DOT_SHAPES = [
      { value: 'circle',    sym: '●' },
      { value: 'square',    sym: '■' },
      { value: 'triangle',  sym: '▲' },
      { value: 'diamond',   sym: '◆' },
      { value: 'slash',     sym: '/' },
      { value: 'backslash', sym: '\\' },
    ];
    const X_SHAPES = [
      { value: 'x',          sym: '×' },
      { value: 'plus',       sym: '+' },
      { value: 'dash',       sym: '—' },
      { value: 'opencircle', sym: '○' },
    ];

    const popup     = document.getElementById('marker-popup');
    const titleEl   = document.getElementById('marker-popup-title');
    const colorIn   = document.getElementById('marker-popup-color');
    const shapeGrid = document.getElementById('marker-shape-grid');
    const closeBtn  = document.getElementById('marker-popup-close');

    let currentType = null;

    const colorKey = t => t === 'dot' ? 'dotColor' : 'xColor';
    const shapeKey = t => t === 'dot' ? 'dotShape' : 'xShape';
    const shapes   = t => t === 'dot' ? DOT_SHAPES : X_SHAPES;

    const applyMeta = (key, val) => {
      this.chart.setMeta(key, val);
      const el = document.getElementById('meta-' + key.toLowerCase());
      if (el) el.value = val;
      clearTimeout(this._metaTimer);
      this._metaTimer = setTimeout(() => this._saveMeta(), 800);
    };

    const openPopup = (type, anchorRect) => {
      currentType = type;
      titleEl.textContent = type === 'dot' ? 'Successes' : 'Errors';
      colorIn.value = this.chart.meta[colorKey(type)] || (type === 'dot' ? '#009933' : '#cc0000');

      const currentShape = this.chart.meta[shapeKey(type)];
      shapeGrid.innerHTML = shapes(type).map(s =>
        `<button class="marker-shape-btn${currentShape === s.value ? ' active' : ''}" data-shape="${s.value}">${s.sym}</button>`
      ).join('');

      popup.classList.remove('hidden');
      const top  = anchorRect.bottom + 6;
      const left = Math.min(anchorRect.left, window.innerWidth - 202);
      popup.style.top  = top  + 'px';
      popup.style.left = left + 'px';
    };

    document.getElementById('legend-box').addEventListener('click', e => {
      const item = e.target.closest('.legend-item--editable');
      if (!item) return;
      openPopup(item.dataset.type, item.getBoundingClientRect());
    });

    colorIn.addEventListener('input', () => {
      if (currentType) applyMeta(colorKey(currentType), colorIn.value);
    });

    shapeGrid.addEventListener('click', e => {
      const btn = e.target.closest('.marker-shape-btn');
      if (!btn || !currentType) return;
      shapeGrid.querySelectorAll('.marker-shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyMeta(shapeKey(currentType), btn.dataset.shape);
    });

    closeBtn.addEventListener('click', () => popup.classList.add('hidden'));

    document.addEventListener('click', e => {
      if (!popup.classList.contains('hidden') &&
          !popup.contains(e.target) &&
          !e.target.closest('.legend-item--editable')) {
        popup.classList.add('hidden');
      }
    });
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

    ['entry-date','entry-successes','entry-errors','entry-floor','entry-note'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') this._addEntry();
      });
    });

    // Hide measurement fields when type is a line (phase or intervention);
    // lock successes to 1 and hide errors for duration/latency (single-trial timing entries)
    document.getElementById('entry-type').addEventListener('change', e => this._applyEntryTypeMode(e.target.value));

    this._applyEntryTypeMode(document.getElementById('entry-type').value);

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

  // Duration/latency are single-trial timing entries: successes is always exactly
  // 1 (this trial happened), there's no separate "errors" count, and the floor
  // field holds the actual duration/latency observed rather than an observation window.
  // Measurement type is locked on the pinpoint instance now, not a per-entry pick.
  _isTimingType() {
    const mt = this.currentInstance?.measurement_type;
    return mt === 'duration' || mt === 'latency';
  }

  _applyEntryTypeMode(type) {
    const isLine   = type === 'phase' || type === 'intervention';
    const isTiming = !isLine && this._isTimingType();

    const successesEl = document.getElementById('entry-successes');
    const errorsEl     = document.getElementById('entry-errors');
    const floorEl      = document.getElementById('entry-floor');
    const successesLbl = document.getElementById('entry-successes-label');
    const errorsGroup   = document.getElementById('entry-errors-group');
    const floorLbl      = document.getElementById('entry-floor-label');

    [successesEl, errorsEl, floorEl].forEach(el => {
      el.closest('.field-group').style.opacity = isLine ? '0.4' : '1';
      el.disabled = isLine;
    });

    if (isTiming) {
      successesEl.value    = '1';
      successesEl.disabled = true;
      errorsEl.value       = '';
      errorsEl.disabled    = true;
      errorsGroup.style.opacity = '0.4';
      successesLbl.textContent  = 'Trial';
      floorLbl.textContent      = this.currentInstance?.measurement_type === 'duration'
        ? 'Duration held (m:ss, m:ss.ms, or h:mm:ss)' : 'Latency (m:ss, m:ss.ms, or h:mm:ss)';
      floorEl.placeholder       = 'e.g. 0:30 or 0:00.8';
    } else if (!isLine) {
      successesEl.disabled     = false;
      errorsEl.disabled        = false;
      errorsGroup.style.opacity = '1';
      successesLbl.textContent  = 'Successes (●)';
      floorLbl.textContent      = 'Floor (m:ss or h:mm:ss)';
      floorEl.placeholder       = 'e.g. 0:30';
    }
  }

  _readLogForm() {
    const type    = document.getElementById('entry-type').value;
    const dateStr = document.getElementById('entry-date').value;
    const note    = document.getElementById('entry-note').value.trim();
    if (!dateStr) { this._showFeedback('Select a date.', true); return null; }
    if (!this.chart.meta.startDate) {
      this._showFeedback('Set Day 0 date in Chart Info first.', true); return null;
    }
    let successes = null, errors = null;
    if (!this.chart._isLineType(type)) {
      const isTiming = this._isTimingType();
      if (isTiming && this.chart.chartType === 'count_per_day') {
        this._showFeedback('Duration/latency entries need a chart type other than "Count Per Day".', true); return null;
      }
      const successCount = isTiming ? 1   : parseInt(document.getElementById('entry-successes').value, 10);
      const errorCount   = isTiming ? NaN : parseInt(document.getElementById('entry-errors').value, 10);
      const hasSuccesses = !isNaN(successCount) && successCount >= 0;
      const hasErrors    = !isNaN(errorCount)   && errorCount   >= 0;
      if (!hasSuccesses && !hasErrors) {
        this._showFeedback('Enter successes, errors, or both.', true); return null;
      }
      if (this.chart.chartType === 'count_per_day') {
        if (hasSuccesses) successes = { val: successCount, floor: null };
        if (hasErrors)    errors    = { val: errorCount,   floor: null };
      } else {
        const floorSec = this._parseFloor(document.getElementById('entry-floor').value.trim());
        if (!floorSec || floorSec <= 0) {
          this._showFeedback('Enter floor time (e.g. 0:30, 0:00.8, or 1:00:00).', true); return null;
        }
        if (hasSuccesses) successes = { val: successCount * 60 / floorSec, floor: floorSec };
        if (hasErrors)    errors    = { val: errorCount   * 60 / floorSec, floor: floorSec };
      }
    }
    const day = Math.round(
      (new Date(dateStr) - new Date(this.chart.meta.startDate)) / 86400000
    );
    return { type, day, note, successes, errors };
  }

  async _addEntry() {
    if (this._editingIndex !== null) { await this._saveEdit(); return; }

    if (!this.currentInstanceId) {
      this._showFeedback('Select a pinpoint from the sidebar first.', true);
      return;
    }

    const entry = this._readLogForm();
    if (!entry) return;
    const { type, day, note, successes, errors } = entry;

    this._setLoading(true);
    try {
      if (this.chart._isLineType(type)) {
        const saved = await DB.points.add({ instance_id: this.currentInstanceId, type, day, val: null, note, floor: null });
        this.chart.points.push({ id: saved.id, type, day, val: null, note, floor: null, px: this.chart.xL(day), py: null });
      } else {
        if (successes) {
          const saved = await DB.points.add({ instance_id: this.currentInstanceId, type: 'dot', day, val: successes.val, note, floor: successes.floor });
          this.chart.points.push({ id: saved.id, type: 'dot', day, val: successes.val, note, floor: successes.floor, px: this.chart.xP(day), py: this.chart.yP(successes.val) });
        }
        if (errors) {
          const saved = await DB.points.add({ instance_id: this.currentInstanceId, type: 'x', day, val: errors.val, note, floor: errors.floor });
          this.chart.points.push({ id: saved.id, type: 'x', day, val: errors.val, note, floor: errors.floor, px: this.chart.xP(day), py: this.chart.yP(errors.val) });
        }
      }
      this.chart.draw();
      this.chart.scrollToDay(day);
      document.getElementById('entry-date').value      = new Date().toISOString().slice(0, 10);
      document.getElementById('entry-successes').value = '';
      document.getElementById('entry-errors').value    = '';
      document.getElementById('entry-floor').value     = '';
      document.getElementById('entry-note').value      = '';
      this._applyEntryTypeMode(type); // re-locks successes to 1 if still in duration/latency mode
      this._renderEntries();
      this._showFeedback('Added.');
      this.goalsManager?.checkGoals(this.chart);
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
    const { type, day, note, successes, errors } = entry;
    const pts = this.chart.getPoints();
    const old = pts[this._editingIndex];
    this._setLoading(true);
    try {
      if (old.id) await DB.points.delete(old.id);
      this.chart.removePoint(this._editingIndex);
      if (this.chart._isLineType(type)) {
        const saved = await DB.points.add({ instance_id: this.currentInstanceId, type, day, val: null, note, floor: null });
        this.chart.points.push({ id: saved.id, type, day, val: null, note, floor: null, px: this.chart.xL(day), py: null });
      } else {
        if (successes) {
          const saved = await DB.points.add({ instance_id: this.currentInstanceId, type: 'dot', day, val: successes.val, note, floor: successes.floor });
          this.chart.points.push({ id: saved.id, type: 'dot', day, val: successes.val, note, floor: successes.floor, px: this.chart.xP(day), py: this.chart.yP(successes.val) });
        }
        if (errors) {
          const saved = await DB.points.add({ instance_id: this.currentInstanceId, type: 'x', day, val: errors.val, note, floor: errors.floor });
          this.chart.points.push({ id: saved.id, type: 'x', day, val: errors.val, note, floor: errors.floor, px: this.chart.xP(day), py: this.chart.yP(errors.val) });
        }
      }
      this.chart.draw();
      this.chart.scrollToDay(day);
      this._exitEditMode();
      this._renderEntries();
      this._showFeedback('Updated.');
      this.goalsManager?.checkGoals(this.chart);
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

    const isLine = this.chart._isLineType(p.type);
    document.getElementById('entry-type').value = isLine ? p.type : 'data';
    document.getElementById('entry-type').dispatchEvent(new Event('change'));

    if (this.chart.meta.startDate) {
      const dt = new Date(this.chart.meta.startDate);
      dt.setUTCDate(dt.getUTCDate() + p.day);
      document.getElementById('entry-date').value = dt.toISOString().slice(0, 10);
    }

    if (!isLine) {
      if (this.chart.chartType === 'count_per_day') {
        document.getElementById('entry-successes').value = p.type === 'dot' ? Math.round(p.val) : '';
        document.getElementById('entry-errors').value    = p.type === 'x'   ? Math.round(p.val) : '';
        document.getElementById('entry-floor').value     = '';
      } else if (p.floor) {
        const count = Math.round(p.val * p.floor / 60);
        document.getElementById('entry-successes').value = p.type === 'dot' ? count : '';
        document.getElementById('entry-errors').value    = p.type === 'x'   ? count : '';
        document.getElementById('entry-floor').value     = this._formatFloor(p.floor);
      } else {
        document.getElementById('entry-successes').value = '';
        document.getElementById('entry-errors').value    = '';
        document.getElementById('entry-floor').value     = '';
      }
    }
    document.getElementById('entry-note').value = p.note || '';

    document.getElementById('btn-add').textContent = 'Save changes';
    document.getElementById('btn-cancel-edit').classList.remove('hidden');
    document.getElementById('btn-undo').classList.add('hidden');
    document.getElementById('btn-clear').classList.add('hidden');
    document.querySelector('.log-section').classList.add('log-section--editing');
    document.querySelector('.log-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  _exitEditMode() {
    this._editingIndex = null;
    document.getElementById('btn-add').textContent = 'Add to chart';
    document.getElementById('btn-cancel-edit').classList.add('hidden');
    document.getElementById('btn-undo').classList.remove('hidden');
    document.getElementById('btn-clear').classList.remove('hidden');
    document.querySelector('.log-section').classList.remove('log-section--editing');
    document.getElementById('entry-type').value = 'data';
    document.getElementById('entry-type').dispatchEvent(new Event('change'));
    document.getElementById('entry-date').value      = new Date().toISOString().slice(0, 10);
    document.getElementById('entry-successes').value = '';
    document.getElementById('entry-errors').value    = '';
    document.getElementById('entry-floor').value     = '';
    document.getElementById('entry-note').value      = '';
  }

  // Accepts h:mm:ss, m:ss, or plain seconds — the last (seconds) segment may carry
  // a decimal (e.g. 0:00.8) for sub-second latency precision; hours/minutes stay whole.
  _parseFloor(str) {
    if (!str) return null;
    const segs = str.split(':');
    if (segs.length < 1 || segs.length > 3) return null;
    const nums = segs.map((s, i) => i === segs.length - 1 ? parseFloat(s) : parseInt(s, 10));
    if (nums.some(isNaN)) return null;
    if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
    if (nums.length === 2) return nums[0] * 60 + nums[1];
    return nums[0];
  }

  _formatFloor(sec) {
    if (!sec) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const sStr = this._formatSecPart(s);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${sStr}`;
    return `${m}:${sStr}`;
  }

  // Whole seconds pad to 2 digits as before ("05"); a fractional remainder (from
  // sub-second latency entries) is appended and trailing zeros are trimmed ("05.8").
  _formatSecPart(sec) {
    const whole = Math.floor(sec);
    let str = String(whole).padStart(2, '0');
    const frac = Math.round((sec - whole) * 1000) / 1000;
    if (frac > 0) {
      let fracStr = frac.toFixed(3).slice(1).replace(/0+$/, '');
      if (fracStr !== '.') str += fracStr;
    }
    return str;
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
    if (!this.currentInstanceId) return;
    if (!confirm('Clear all data for this pinpoint?')) return;
    this._setLoading(true);
    try {
      await DB.points.clear(this.currentInstanceId);
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
      const rateDetail = this.chart.chartType === 'count_per_day'
        ? `${Math.round(p.val)} count`
        : p.floor
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

  // ── Export ────────────────────────────────────────────────────────────────
  // Wired from app.js's _renderUserBadge(), since #btn-export-image now lives
  // in the dynamically-rendered badge, not in the static page markup.

  _exportChartImage() {
    const sourceCanvas = document.getElementById('scc-canvas');
    if (!sourceCanvas) return;

    const instanceName = this.currentInstance?.name || 'Chart';
    const primaryLabel = this._context
      ? [this._context.participantName, instanceName].filter(Boolean).join(' › ')
      : instanceName;

    const rows = [{
      label: primaryLabel,
      dotColor: this.chart.meta.dotColor || '#009933',
      xColor:   this.chart.meta.xColor   || '#cc0000',
    }];

    const legendH = 22 + rows.length * 18;
    const out = document.createElement('canvas');
    out.width  = sourceCanvas.width;
    out.height = sourceCanvas.height + legendH;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(sourceCanvas, 0, 0);

    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.fillStyle = '#003344';
    ctx.textAlign = 'left';
    ctx.fillText('Legend', 16, sourceCanvas.height + 18);

    ctx.font = '12px Arial, sans-serif';
    rows.forEach((row, idx) => {
      const y = sourceCanvas.height + 38 + idx * 18;
      ctx.fillStyle = row.dotColor;
      ctx.fillText('●', 16, y);
      ctx.fillStyle = row.xColor;
      ctx.fillText('×', 32, y);
      ctx.fillStyle = '#003344';
      ctx.fillText(row.label || 'Chart', 50, y);
    });

    out.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chart.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  // Scoped to .content (the real dashboard's own container) — .chart-section
  // also exists inside the separate Overlay Comparison view, and an unscoped
  // querySelector would grab whichever one comes first in the document.
  _showBehaviorPrompt() {
    const root = document.querySelector('.content');
    document.getElementById('behavior-prompt')?.classList.remove('hidden');
    ['.chart-type-section', '.chart-section', '.review-goals-row', '.entries-section'].forEach(sel =>
      root?.querySelector(sel)?.classList.add('hidden')
    );
  }

  _hideBehaviorPrompt() {
    const root = document.querySelector('.content');
    document.getElementById('behavior-prompt')?.classList.add('hidden');
    ['.chart-type-section', '.chart-section', '.review-goals-row', '.meta-section', '.entries-section']
      .forEach(sel => root?.querySelector(sel)?.classList.remove('hidden'));
  }

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
