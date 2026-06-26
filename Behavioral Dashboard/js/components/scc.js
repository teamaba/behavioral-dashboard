/**
 * scc.js — Standard Celeration Chart, PrecisionX 4-type system
 * Chart types: timings, daily, weekly, monthly
 * Y-axis: COUNT PER MINUTE, 0.001–1000 log scale (same for all types).
 * Weekly / Monthly support aggregation: Geometric Mean, Median, Average.
 * viewStart controls the visible column window (scrolls freely in both directions).
 * Regression: least-squares best-fit lines drawn separately for dots and x marks.
 */

class SCCChart {
  constructor(canvasId, tooltipId) {
    this.canvas  = document.getElementById(canvasId);
    this.ctx     = this.canvas.getContext('2d');
    this.tooltip = document.getElementById(tooltipId);
    this.points  = [];
    this.chartType   = 'daily';
    this.aggregation = 'geomean';
    this.viewStart   = 0;
    this._plottableCache      = null;
    this._timingGroups        = [];
    this._noteCarets          = [];
    this._timingRegressions   = [];
    this._celerationLineHits  = [];
    this.aimLow               = null;
    this.aimHigh         = null;

    this.meta = {
      organization: '', supervisor: '', counter: '',
      charter: '', environment: '', timer: '',
      correct: '', incorrect: '', neutral: '',
      acceltarget: '', deceltarget: '',
      startDate: '', goal: '',
      dotColor: '#009933', dotShape: 'circle',
      xColor:   '#cc0000', xShape:   'x'
    };

    this.W = 1010;
    this.H = 722;
    this.canvas.width  = this.W;
    this.canvas.height = this.H;

    this.PL   = 78;
    this.PR   = 80;
    this.PB   = 58;
    this.DAYS = 140;

    this.TIMING_ZERO_COL = 20;
    this.MONTH_ZERO_COL  = 72;

    this.C_CYCLE = '#00bcd4';
    this.C_FIVE  = '#33ccdd';
    this.C_MINOR = '#99e6f0';
    this.C_SUN   = '#008faa';
    this.C_DAY   = '#aaebf5';
    this.C_TEXT  = '#0099cc';

    // Regression line colours
    this.C_REG_DOT = '#009933';
    this.C_REG_X   = '#cc0000';

    this._applyTypeConfig();
    this._bindTooltip();
    this.draw();
  }

  // ── Type configuration ────────────────────────────────────────────────────

  _TYPE_CONFIG = {
    'timings':       { PT: 110 },
    'daily':         { PT: 88  },
    'weekly':        { PT: 88  },
    'monthly':       { PT: 110 },
    'count_per_day': { PT: 88  },
  };

  _cfg() { return this._TYPE_CONFIG[this.chartType] || this._TYPE_CONFIG['daily']; }

  _applyTypeConfig() {
    this.PT        = this._cfg().PT;
    const cpd      = this.chartType === 'count_per_day';
    this.LOG_MIN   = cpd ? 0  : -3;
    this.LOG_MAX   = cpd ? 6  :  3;
    this.LOG_RANGE = this.LOG_MAX - this.LOG_MIN;
    this.cW   = this.W - this.PL - this.PR;
    this.cH   = this.H - this.PT - this.PB;
    this.dayW = this.cW / this.DAYS;
  }

  setChartType(type) {
    this.chartType = type;
    this.viewStart = 0;
    this._applyTypeConfig();
    this.draw();
  }

  setAggregation(method) {
    this.aggregation = method;
    this.draw();
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  colL(c) { return this.PL + (c - this.viewStart) * this.dayW; }
  colC(c) { return this.PL + (c - this.viewStart + 0.5) * this.dayW; }
  xL(d)  { return this.colL(d); }
  xP(d)  { return this.colC(d); }

  yP(v) {
    if (!v || v <= 0) return this.PT + this.cH + 20;
    const l = Math.max(this.LOG_MIN, Math.min(this.LOG_MAX, Math.log10(v)));
    return this.PT + this.cH - ((l - this.LOG_MIN) / this.LOG_RANGE) * this.cH;
  }

  yToVal(py) {
    const frac = (this.PT + this.cH - py) / this.cH;
    return Math.pow(10, this.LOG_MIN + frac * this.LOG_RANGE);
  }

  xToDay(px) {
    return Math.floor((px - this.PL) / this.dayW) + this.viewStart;
  }

  inChart(x, y) {
    return x >= this.PL && x <= this.PL + this.cW &&
           y >= this.PT && y <= this.PT + this.cH;
  }

  timingToCol(i) { return i + this.TIMING_ZERO_COL; }
  monthToCol(m)  { return m + this.MONTH_ZERO_COL;  }

  _startDate() {
    if (!this.meta.startDate) return null;
    const d = new Date(this.meta.startDate);
    return isNaN(d) ? null : d;
  }

  _monthOffsetOf(day) {
    const sd = this._startDate();
    if (!sd) return Math.floor(day / 30);
    const end = new Date(sd);
    end.setDate(end.getDate() + day);
    return (end.getFullYear() - sd.getFullYear()) * 12 +
           (end.getMonth()    - sd.getMonth());
  }

  // ── Scroll API ────────────────────────────────────────────────────────────

  _scrollStep() {
    return { timings: 20, daily: 14, weekly: 10, monthly: 12, count_per_day: 14 }[this.chartType] || 14;
  }

  scrollBy(delta) { this.viewStart += delta; this.draw(); }
  scrollHome()    { this.viewStart  = 0;     this.draw(); }

  scrollToDay(rawDay) {
    let targetCol;
    switch (this.chartType) {
      case 'timings': {
        const group = [...this._timingGroups].reverse().find(g => g.day === rawDay);
        targetCol = group
          ? group.endCol
          : (this._timingGroups.length
              ? this._timingGroups[this._timingGroups.length - 1].endCol
              : this.viewStart);
        break;
      }
      case 'weekly':  targetCol = Math.floor(rawDay / 7); break;
      case 'monthly': targetCol = this.monthToCol(this._monthOffsetOf(rawDay)); break;
      default:        targetCol = rawDay;
    }
    const margin = Math.max(7, Math.floor(this.DAYS * 0.08));
    if (targetCol < this.viewStart + margin || targetCol > this.viewStart + this.DAYS - margin) {
      this.viewStart = targetCol - Math.floor(this.DAYS / 2);
      this.draw();
    }
  }

  // ── Aggregation ───────────────────────────────────────────────────────────

  _aggregate(values) {
    const vals = values.filter(v => typeof v === 'number' && v > 0);
    if (!vals.length) return null;
    switch (this.aggregation) {
      case 'geomean': {
        const logSum = vals.reduce((s, v) => s + Math.log(v), 0);
        return Math.exp(logSum / vals.length);
      }
      case 'median': {
        const sorted = [...vals].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2;
      }
      case 'average':
        return vals.reduce((s, v) => s + v, 0) / vals.length;
      default: return null;
    }
  }

  // ── Plottable points ──────────────────────────────────────────────────────
  //
  // Weekly / Monthly: aggregate dot and x types SEPARATELY so regression
  // can draw independent best-fit lines for each.

  _getPlottablePoints() {
    if (this._plottableCache) return this._plottableCache;
    this._plottableCache = this._computePlottable();
    return this._plottableCache;
  }

  _computePlottable() {
    const raw = this.points;

    switch (this.chartType) {

      // ── Daily ────────────────────────────────────────────────────────────
      case 'daily': {
        return [...raw]
          .sort((a, b) => a.day - b.day)
          .map(p => ({
            ...p,
            col: p.day,
            px:  this._isLineType(p.type) ? this.colL(p.day) : this.colC(p.day),
            py:  this._isLineType(p.type) ? null
                 : (p.val === 0 && p.floor > 0 ? this.yP(0.5 * 60 / p.floor) : this.yP(p.val)),
          }));
      }

      // ── Count per day ────────────────────────────────────────────────────
      case 'count_per_day': {
        const dotTotals = {}, xTotals = {};
        const result = [];
        [...raw].sort((a, b) => a.day - b.day).forEach(p => {
          if (this._isLineType(p.type)) {
            result.push({ ...p, col: p.day, px: this.colL(p.day), py: null });
          } else if (p.type === 'dot') {
            dotTotals[p.day] = (dotTotals[p.day] || 0) + (p.val || 0);
          } else if (p.type === 'x') {
            xTotals[p.day] = (xTotals[p.day] || 0) + (p.val || 0);
          }
        });
        Object.entries(dotTotals).forEach(([day, v]) => {
          const d = Number(day);
          if (v <= 0) return;
          result.push({ type: 'dot', col: d, day: d, val: v, note: '', px: this.colC(d), py: this.yP(v) });
        });
        Object.entries(xTotals).forEach(([day, v]) => {
          const d = Number(day);
          if (v <= 0) return;
          result.push({ type: 'x', col: d, day: d, val: v, note: '', px: this.colC(d), py: this.yP(v) });
        });
        return result.sort((a, b) => a.col !== b.col ? a.col - b.col : (this._isLineType(a.type) ? -1 : 1));
      }

      // ── Weekly ───────────────────────────────────────────────────────────
      case 'weekly': {
        const dotBuckets = {}, xBuckets = {};
        const result = [];
        [...raw].sort((a, b) => a.day - b.day).forEach(p => {
          const week = Math.floor(p.day / 7);
          if (this._isLineType(p.type)) {
            result.push({ ...p, col: week, day: week, px: this.colL(week), py: null });
          } else if (p.type === 'dot') {
            if (!dotBuckets[week]) dotBuckets[week] = [];
            dotBuckets[week].push(p.val);
          } else if (p.type === 'x') {
            if (!xBuckets[week]) xBuckets[week] = [];
            xBuckets[week].push(p.val);
          }
        });
        const pushBucket = (buckets, type) =>
          Object.entries(buckets).forEach(([week, vals]) => {
            const v = this._aggregate(vals);
            if (v == null) return;
            const col = Number(week);
            result.push({ type, col, day: col, val: v,
              note: vals.length > 1 ? `(${vals.length})` : '',
              px: this.colC(col), py: this.yP(v) });
          });
        pushBucket(dotBuckets, 'dot');
        pushBucket(xBuckets,   'x');
        return result.sort((a, b) =>
          a.col !== b.col ? a.col - b.col : (this._isLineType(a.type) ? -1 : 1));
      }

      // ── Monthly ──────────────────────────────────────────────────────────
      case 'monthly': {
        const dotBuckets = {}, xBuckets = {};
        const result = [];
        [...raw].sort((a, b) => a.day - b.day).forEach(p => {
          const m   = this._monthOffsetOf(p.day);
          const col = this.monthToCol(m);
          if (this._isLineType(p.type)) {
            result.push({ ...p, col, day: m, px: this.colL(col), py: null });
          } else if (p.type === 'dot') {
            if (!dotBuckets[m]) dotBuckets[m] = [];
            dotBuckets[m].push(p.val);
          } else if (p.type === 'x') {
            if (!xBuckets[m]) xBuckets[m] = [];
            xBuckets[m].push(p.val);
          }
        });
        const pushBucket = (buckets, type) =>
          Object.entries(buckets).forEach(([m, vals]) => {
            const v = this._aggregate(vals);
            if (v == null) return;
            const mNum = Number(m);
            const col  = this.monthToCol(mNum);
            result.push({ type, col, day: mNum, val: v,
              note: vals.length > 1 ? `(${vals.length})` : '',
              px: this.colC(col), py: this.yP(v) });
          });
        pushBucket(dotBuckets, 'dot');
        pushBucket(xBuckets,   'x');
        return result.sort((a, b) =>
          a.col !== b.col ? a.col - b.col : (this._isLineType(a.type) ? -1 : 1));
      }

      // ── Timings ──────────────────────────────────────────────────────────
      case 'timings': {
        const DAY_COLS = 10; // minimum column width per session (~1.5 weeks)
        const sorted = [...raw].sort((a, b) => a.day - b.day);
        const result = [];
        this._timingGroups = [];

        // Pass 1: count data points per calendar day (in order)
        const dayOrder = [];
        const dayCount = new Map();
        for (const p of sorted) {
          if (!this._isLineType(p.type)) {
            if (!dayCount.has(p.day)) { dayOrder.push(p.day); dayCount.set(p.day, 0); }
            dayCount.set(p.day, dayCount.get(p.day) + 1);
          }
        }

        // Pass 2: assign column start for each day
        const dayStart = new Map();
        let nextCol = this.TIMING_ZERO_COL;
        for (const day of dayOrder) {
          dayStart.set(day, nextCol);
          const w = Math.max(dayCount.get(day), DAY_COLS);
          this._timingGroups.push({ day, startCol: nextCol, endCol: nextCol + w - 1 });
          nextCol += w;
        }

        // Pass 3: place each point
        const dayMsmt = new Map();
        for (const p of sorted) {
          if (this._isLineType(p.type)) {
            // Phase/intervention: place at start of the first session on or after this day
            let sc = nextCol;
            for (const day of dayOrder) {
              if (day >= p.day) { sc = dayStart.get(day); break; }
            }
            result.push({ ...p, col: sc, px: this.colL(sc), py: null });
          } else {
            const sc = dayStart.get(p.day);
            const idx = dayMsmt.get(p.day) ?? 0;
            dayMsmt.set(p.day, idx + 1);
            const c = sc + idx;
            result.push({ ...p, col: c, px: this.colC(c), py: p.val === 0 && p.floor > 0 ? this.yP(0.5 * 60 / p.floor) : this.yP(p.val) });
          }
        }

        return result.sort((a, b) =>
          a.col !== b.col ? a.col - b.col : (this._isLineType(a.type) ? -1 : 1));
      }
    }
    return [];
  }

  // ── Least-squares regression ──────────────────────────────────────────────
  //
  // Regression is performed in log space: log10(y) = m·x + b.
  // A straight line on the log chart represents exponential growth/decay.

  _leastSquares(pairs) {
    const n = pairs.length;
    if (n < 2) return { m: null, b: null, n };
    const xMean = pairs.reduce((s, p) => s + p.x, 0) / n;
    const yMean = pairs.reduce((s, p) => s + p.y, 0) / n;
    const num = pairs.reduce((s, p) => s + (p.x - xMean) * (p.y - yMean), 0);
    const den = pairs.reduce((s, p) => s + (p.x - xMean) ** 2, 0);
    if (den < 1e-10) return { m: null, b: null, n }; // all x identical
    const m = num / den;
    const b = yMean - m * xMean;
    return { m, b, n };
  }

  _computeRegressions() {
    const pts = this._getPlottablePoints().filter(p => !this._isLineType(p.type) && p.val > 0);

    const withRange = (reg, pairs) => {
      if (reg.m !== null && pairs.length >= 2) {
        reg.minCol = Math.min(...pairs.map(p => p.x));
        reg.maxCol = Math.max(...pairs.map(p => p.x));
        const residuals = pairs.map(p => p.y - (reg.m * p.x + reg.b));
        const maxUp   = Math.max(...residuals);
        const maxDown = Math.max(...residuals.map(r => -r));
        reg.bounce = Math.pow(10, Math.max(maxUp, maxDown));
      }
      return reg;
    };

    if (this.chartType === 'timings') {
      this._timingRegressions = this._timingGroups.map(g => {
        const dayPts   = pts.filter(p => p.day === g.day);
        const dotPairs = dayPts.filter(p => p.type === 'dot').map(p => ({ x: p.col, y: Math.log10(p.val) }));
        const xPairs   = dayPts.filter(p => p.type === 'x'  ).map(p => ({ x: p.col, y: Math.log10(p.val) }));
        return {
          day:      g.day,
          startCol: g.startCol,
          endCol:   g.endCol,
          dot:      withRange(this._leastSquares(dotPairs), dotPairs),
          x:        withRange(this._leastSquares(xPairs),   xPairs),
        };
      });
      return { dot: { m: null }, x: { m: null } };
    }

    const dotPts = pts.filter(p => p.type === 'dot').map(p => ({ x: p.col, y: Math.log10(p.val) }));
    const xPts   = pts.filter(p => p.type === 'x'  ).map(p => ({ x: p.col, y: Math.log10(p.val) }));

    return {
      dot: withRange(this._leastSquares(dotPts), dotPts),
      x:   withRange(this._leastSquares(xPts),   xPts),
    };
  }

  _drawRegressionLines(regressions) {
    const { ctx } = this;
    this._celerationLineHits = [];

    const drawLine = (reg, color) => {
      if (!reg || reg.m === null || reg.minCol == null) return;
      const { m, b, minCol, maxCol } = reg;
      const py1 = this.yP(Math.pow(10, m * minCol + b));
      const py2 = this.yP(Math.pow(10, m * maxCol + b));
      ctx.save();
      ctx.beginPath(); ctx.rect(this.PL, this.PT, this.cW, this.cH); ctx.clip();
      ctx.strokeStyle = color; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(this.colC(minCol), py1);
      ctx.lineTo(this.colC(maxCol), py2);
      ctx.stroke();
      ctx.restore();
    };

    if (this.chartType === 'timings') {
      for (const tr of this._timingRegressions) {
        drawLine(tr.dot, this.C_REG_DOT);
        drawLine(tr.x,   this.C_REG_X);
        if (tr.dot.m !== null || tr.x.m !== null) {
          this._celerationLineHits.push(tr);
        }
      }
      return;
    }

    drawLine(regressions.dot, this.C_REG_DOT);
    drawLine(regressions.x,   this.C_REG_X);
  }

  // ── Slope box ─────────────────────────────────────────────────────────────

  _updateSlopeBox(regressions) {
    const box = document.getElementById('slope-box');
    if (!box) return;

    if (this.chartType === 'timings') { box.innerHTML = ''; return; }

    // Express slope as a celeration factor per natural unit for the chart type
    const perUnit   = { daily: 7, weekly: 1, monthly: 1, count_per_day: 7 }[this.chartType] || 1;
    const unitLabel = { daily: '/wk', weekly: '/wk', monthly: '/mo', count_per_day: '/wk' }[this.chartType] || '/wk';

    const fmtFactor = reg => {
      if (!reg || reg.m === null) return '—';
      const factor = Math.pow(10, reg.m * perUnit);
      if (Math.abs(factor - 1) < 0.005) return '×1.00' + unitLabel;
      if (factor > 1) {
        return '×' + (factor >= 10 ? factor.toFixed(1) : factor.toFixed(2)) + unitLabel;
      }
      const inv = 1 / factor;
      return '÷' + (inv >= 10 ? inv.toFixed(1) : inv.toFixed(2)) + unitLabel;
    };

    const fmtBounce = reg => {
      if (!reg || reg.bounce == null) return '—';
      const b = reg.bounce;
      return '×' + (b >= 10 ? b.toFixed(1) : b.toFixed(2));
    };

    const fmtTarget = (targetStr, isAccel) => {
      const t = parseFloat(targetStr);
      if (!targetStr || isNaN(t) || t <= 0) return '—';
      const prefix = isAccel ? '×' : '÷';
      return prefix + (t >= 10 ? t.toFixed(1) : t.toFixed(2)) + unitLabel;
    };

    const item = (reg, label, color, targetStr, isAccel) => `
      <div class="slope-item">
        <span class="slope-label" style="color:${color}">${label}</span>
        <div class="slope-row">
          <span class="slope-sub-label">Target</span>
          <span class="slope-val" style="color:${color}">${fmtTarget(targetStr, isAccel)}</span>
        </div>
        <div class="slope-row">
          <span class="slope-sub-label">Celeration</span>
          <span class="slope-val" style="color:${color}">${fmtFactor(reg)}</span>
        </div>
        <div class="slope-row">
          <span class="slope-sub-label">Bounce</span>
          <span class="slope-val" style="color:${color}">${fmtBounce(reg)}</span>
        </div>
        <span class="slope-n">${reg ? reg.n : 0} pt${reg && reg.n === 1 ? '' : 's'}</span>
      </div>`;

    box.innerHTML =
      item(regressions.dot, 'Successes', this.C_REG_DOT, this.meta.acceltarget, true) +
      item(regressions.x,   'Errors',    this.C_REG_X,   this.meta.deceltarget, false);
  }

  // ── Main draw ─────────────────────────────────────────────────────────────

  draw() {
    this._plottableCache = null;
    this._timingGroups   = [];
    this._noteCarets     = [];
    this.C_REG_DOT = this.meta.dotColor || '#009933';
    this.C_REG_X   = this.meta.xColor   || '#cc0000';
    this._drawGrid();
    this._drawRightAxis();
    this._drawAimBand();
    this._drawFloorTicks();
    this._drawPoints();
    const reg = this._computeRegressions();
    this._drawRegressionLines(reg);
    this._updateSlopeBox(reg);
    this._drawNoteCarets();
    this._updateLegend();
    this.afterDraw?.();
  }

  getStats() {
    const pts    = this._getPlottablePoints().filter(p => !this._isLineType(p.type) && p.val > 0);
    const dotPts = pts.filter(p => p.type === 'dot');
    const xPts   = pts.filter(p => p.type === 'x');

    const regAndStats = typePts => {
      if (typePts.length < 2) return { cel: null, bounce: null };
      const pairs = typePts.map(p => ({ x: p.col, y: Math.log10(p.val) }));
      const reg   = this._leastSquares(pairs);
      if (reg.m === null) return { cel: null, bounce: null };
      const perUnit = { daily: 7, weekly: 1, monthly: 1, timings: 1, count_per_day: 7 }[this.chartType] || 7;
      const residuals = pairs.map(p => Math.abs(p.y - (reg.m * p.x + reg.b)));
      return { cel: Math.pow(10, reg.m * perUnit), bounce: Math.pow(10, Math.max(...residuals)) };
    };

    const sorted = [...dotPts].sort((a, b) => b.col - a.col).slice(0, 7);
    const level  = sorted.length
      ? Math.pow(10, sorted.reduce((s, p) => s + Math.log10(p.val), 0) / sorted.length)
      : null;

    const { cel: dotCel, bounce: dotBounce } = regAndStats(dotPts);
    const tgt      = parseFloat(this.meta.acceltarget);
    const impIndex = dotCel && !isNaN(tgt) && tgt > 0 ? dotCel / tgt : null;

    const phases    = this.points.filter(p => this._isLineType(p.type)).sort((a, b) => b.day - a.day);
    const condition = phases.length ? (phases[0].note || null) : null;

    return { level, dotCeleration: dotCel, dotBounce, impIndex, condition };
  }

  // ── Fluency aim band ─────────────────────────────────────────────────────

  setAimRange(low, high) {
    this.aimLow  = (low  > 0) ? low  : null;
    this.aimHigh = (high > 0) ? high : null;
    this.draw();
  }

  _drawAimBand() {
    const { aimLow, aimHigh } = this;
    if (!aimLow && !aimHigh) return;
    const { ctx } = this;
    ctx.save();

    if (aimLow && aimHigh) {
      const yTop    = Math.max(this.PT, this.yP(Math.max(aimLow, aimHigh)));
      const yBottom = Math.min(this.PT + this.cH, this.yP(Math.min(aimLow, aimHigh)));
      if (yBottom > yTop) {
        ctx.fillStyle = 'rgba(245, 197, 0, 0.15)';
        ctx.fillRect(this.PL, yTop, this.cW, yBottom - yTop);
      }
      [aimLow, aimHigh].forEach(rate => {
        const y = this.yP(rate);
        if (y < this.PT || y > this.PT + this.cH) return;
        ctx.strokeStyle = '#f5c500';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(this.PL, y);
        ctx.lineTo(this.PL + this.cW, y);
        ctx.stroke();
      });
      ctx.setLineDash([]);
      const yMid = (this.yP(aimLow) + this.yP(aimHigh)) / 2;
      if (yMid >= this.PT && yMid <= this.PT + this.cH) {
        ctx.fillStyle = '#9a7a00';
        ctx.font = 'bold 9px Arial,sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('AIM', this.PL - 24, yMid + 3.5);
      }
    } else {
      const rate = aimLow || aimHigh;
      const y = this.yP(rate);
      if (y >= this.PT && y <= this.PT + this.cH) {
        ctx.strokeStyle = '#f5c500';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(this.PL, y);
        ctx.lineTo(this.PL + this.cW, y);
        ctx.stroke();
        ctx.fillStyle = '#9a7a00';
        ctx.font = 'bold 9px Arial,sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('AIM', this.PL - 24, y + 3.5);
      }
    }
    ctx.restore();
  }

  // ── Right Y-axis (Counting Times) ────────────────────────────────────────

  _drawRightAxis() {
    if (this.chartType === 'count_per_day') return;
    const { ctx } = this;
    const x = this.PL + this.cW + 6;

    // (rate per minute, label) pairs — rate = 60 / counting_time_seconds
    const labels = [
      [60, '1s'], [30, '2s'], [12, '5s'], [6, '10s'], [3, '20s'], [2, '30s'],
      [1, '1m'], [0.5, '2m'], [0.2, '5m'], [0.1, '10m'], [0.05, '20m'],
      [1/30, '30m'], [1/60, '1h'], [1/120, '2h']
    ];

    ctx.fillStyle = this.C_TEXT;
    ctx.font = '8px Arial,sans-serif';
    ctx.textAlign = 'left';

    labels.forEach(([rate, label]) => {
      const y = this.yP(rate);
      if (y < this.PT - 1 || y > this.PT + this.cH + 1) return;
      ctx.fillText(label, x, y + 3);
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(this.PL + this.cW, y);
      ctx.lineTo(this.PL + this.cW + 4, y);
      ctx.stroke();
    });

    // Vertical "COUNTING TIMES" title
    ctx.save();
    ctx.translate(this.W - 10, this.PT + this.cH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = 'bold 10px Arial,sans-serif';
    ctx.fillStyle = this.C_TEXT;
    ctx.textAlign = 'center';
    ctx.fillText('COUNTING TIMES', 0, 0);
    ctx.restore();
  }

  // ── Floor ticks ───────────────────────────────────────────────────────────

  _drawFloorTicks() {
    if (this.chartType === 'count_per_day') return;
    const pts = this._getPlottablePoints().filter(p => p.floor && p.floor > 0 && !this._isLineType(p.type));
    if (!pts.length) return;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.PL, this.PT, this.cW, this.cH);
    ctx.clip();
    ctx.lineWidth = 1.5;
    pts.forEach(p => {
      const y = this.yP(60 / p.floor);
      if (y < this.PT || y > this.PT + this.cH) return;
      ctx.strokeStyle = p.type === 'x' ? this.C_REG_X : this.C_REG_DOT;
      ctx.beginPath();
      ctx.moveTo(p.px - 5, y);
      ctx.lineTo(p.px + 5, y);
      ctx.stroke();
    });
    ctx.restore();
  }

  _drawGrid() {
    const { ctx, W, H, PL, PT, cW, cH } = this;
    const vs = this.viewStart, ve = vs + this.DAYS;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Horizontal frequency lines
    for (let e = this.LOG_MIN; e < this.LOG_MAX; e++) {
      for (let m = 1; m <= 9; m++) {
        const v = m * Math.pow(10, e);
        const y = this.yP(v);
        if (y < PT - 1 || y > PT + cH + 1) continue;
        ctx.strokeStyle = m === 1 ? this.C_CYCLE : m === 5 ? this.C_FIVE : this.C_MINOR;
        ctx.lineWidth   = m === 1 ? 1.5 : m === 5 ? 0.9 : 0.5;
        ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + cW, y); ctx.stroke();
      }
    }
    ctx.strokeStyle = this.C_CYCLE; ctx.lineWidth = 1.5;
    const topY = this.yP(Math.pow(10, this.LOG_MAX));
    ctx.beginPath(); ctx.moveTo(PL, topY); ctx.lineTo(PL + cW, topY); ctx.stroke();

    // Vertical column lines
    const majorEvery = { timings: 20, daily: 7, weekly: 10, monthly: 12 }[this.chartType] || 7;
    const zeroCol    = this.chartType === 'monthly' ? this.MONTH_ZERO_COL
                     : this.chartType === 'timings' ? this.TIMING_ZERO_COL : -Infinity;

    for (let col = vs; col <= ve; col++) {
      const x       = this.colL(col);
      const isMajor = col % majorEvery === 0;
      const isZero  = col === zeroCol;
      ctx.strokeStyle = (isMajor || isZero) ? this.C_SUN : this.C_DAY;
      ctx.lineWidth   = isZero ? 2.0 : isMajor ? 1.4 : 0.45;
      ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + cH); ctx.stroke();
    }

    ctx.strokeStyle = this.C_CYCLE; ctx.lineWidth = 1.8;
    ctx.strokeRect(PL, PT, cW, cH);

    this._renderYAxis();
    this._renderXAxis();
    this._drawFooterOnCanvas();
  }

  // ── Y-axis ────────────────────────────────────────────────────────────────

  _renderYAxis() {
    if (this.chartType === 'count_per_day') {
      this._drawYLabelSet([
        [1000000, '1,000,000', true],
        [500000,  '500,000',   false],
        [100000,  '100,000',   true],
        [50000,   '50,000',    false],
        [10000,   '10,000',    true],
        [5000,    '5,000',     false],
        [1000,    '1,000',     true],
        [500,     '500',       false],
        [100,     '100',       true],
        [50,      '50',        false],
        [10,      '10',        true],
        [5,       '5',         false],
        [1,       '1',         true],
      ]);
      const { ctx } = this;
      const y = this.PT + this.cH;
      ctx.fillStyle = this.C_TEXT;
      ctx.font = 'bold 11px Arial,sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('0', this.PL - 4, y + 14);
      ctx.strokeStyle = this.C_CYCLE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.PL - 4, y); ctx.lineTo(this.PL, y); ctx.stroke();
      this._drawYTitle('COUNT PER DAY');
      return;
    }
    this._drawYLabelSet([
      [1000,'1000',true],[500,'500',false],[200,'200',false],
      [100,'100',true],[50,'50',false],[20,'20',false],
      [10,'10',true],[5,'5',false],[2,'2',false],
      [1,'1',true],[0.5,'.5',false],[0.2,'.2',false],
      [0.1,'.1',true],[0.05,'.05',false],[0.02,'.02',false],
      [0.01,'.01',true],[0.005,'.005',false],[0.002,'.002',false],
      [0.001,'.001',true]
    ]);
    this._drawYTitle('COUNT PER MINUTE');
  }

  _drawYLabelSet(labels) {
    const { ctx } = this;
    labels.forEach(([v, label, big]) => {
      const y = this.yP(v);
      if (y < this.PT - 2 || y > this.PT + this.cH + 2) return;
      ctx.fillStyle = this.C_TEXT;
      ctx.font = (big ? 'bold 11px' : '8.5px') + ' Arial,sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(label, this.PL - 4, y + 3.5);
      ctx.strokeStyle = big ? this.C_CYCLE : this.C_FIVE;
      ctx.lineWidth = big ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(this.PL - 4, y); ctx.lineTo(this.PL, y); ctx.stroke();
    });
  }

  _drawYTitle(title) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(13, this.PT + this.cH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = this.C_TEXT;
    ctx.font = 'bold 11px Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, 0, 0);
    ctx.restore();
  }

  // ── X-axis renderers ──────────────────────────────────────────────────────

  _renderXAxis() {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.PL, 0, this.cW, this.H);
    ctx.clip();
    ({ timings:       () => this._renderXAxis_timings(),
       daily:         () => this._renderXAxis_daily(),
       weekly:        () => this._renderXAxis_weekly(),
       monthly:       () => this._renderXAxis_monthly(),
       count_per_day: () => this._renderXAxis_daily(),
    }[this.chartType] || (() => this._renderXAxis_daily()))();
    ctx.restore();
  }

  _renderXAxis_timings() {
    const { ctx } = this;
    const vs = this.viewStart, ve = vs + this.DAYS;
    ctx.fillStyle = this.C_TEXT;
    ctx.font = 'bold 10px Arial,sans-serif';
    ctx.textAlign = 'center';
    const first20 = Math.ceil(vs / 20) * 20;
    for (let col = first20; col <= ve; col += 20) {
      const x = this.colL(col);
      ctx.fillText(String(col - this.TIMING_ZERO_COL), x, this.PT + this.cH + 15);
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x, this.PT + this.cH + 1); ctx.lineTo(x, this.PT + this.cH + 7); ctx.stroke();
    }
    ctx.font = 'bold 11px Arial,sans-serif';
    ctx.fillText('SUCCESSIVE TIMED MEASUREMENTS', this.PL + this.cW / 2, this.PT + this.cH + 28);
  }

  _renderXAxis_daily() {
    const { ctx } = this;
    const sd = this._startDate();
    const vs = this.viewStart, ve = vs + this.DAYS;

    ctx.fillStyle = this.C_TEXT;
    ctx.font = 'bold 10px Arial,sans-serif';
    ctx.textAlign = 'center';
    const first14 = Math.ceil(vs / 14) * 14;
    for (let col = first14; col <= ve; col += 14) {
      ctx.fillText(String(col), this.colL(col), this.PT + this.cH + 15);
    }
    ctx.font = 'bold 11px Arial,sans-serif';
    ctx.fillText('SUCCESSIVE CALENDAR DAYS', this.PL + this.cW / 2, this.PT + this.cH + 28);

    const wStart = Math.floor(vs / 7), wEnd = Math.ceil(ve / 7);
    const firstW4 = Math.ceil(wStart / 4) * 4;
    ctx.font = '10px Arial,sans-serif';
    for (let w = firstW4; w <= wEnd; w += 4) {
      const x = this.colL(w * 7);
      if (x < this.PL - 10 || x > this.PL + this.cW + 10) continue;
      ctx.textAlign = 'center'; ctx.fillStyle = this.C_TEXT;
      ctx.fillText(String(w), x, this.PT - 36);
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, this.PT - 32); ctx.lineTo(x, this.PT - 24); ctx.stroke();
    }

    const first28 = Math.floor(vs / 28) * 28;
    for (let col = first28; col <= ve + 28; col += 28) {
      const x = this.colL(col);
      if (x > this.PL + this.cW + 40) continue;
      ctx.textAlign = 'left';
      if (sd) {
        const dt = new Date(sd); dt.setDate(dt.getDate() + col);
        const dd = String(dt.getDate()).padStart(2,'0');
        const mm = String(dt.getMonth()+1).padStart(2,'0');
        const yy = String(dt.getFullYear()).slice(-2);
        ctx.fillStyle = '#003344'; ctx.font = 'bold 10px Arial,sans-serif';
        ctx.fillText(`${dd} ${mm} ${yy}`, x + 4, this.PT - 22);
        ctx.fillStyle = this.C_TEXT;
      } else {
        ctx.fillStyle = this.C_TEXT; ctx.font = '9px Arial,sans-serif';
        ctx.fillText('Dy Mo Yr', x + 4, this.PT - 22);
      }
      const x2 = Math.min(this.colL(col + 28), this.PL + this.cW);
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x, this.PT - 18); ctx.lineTo(x2, this.PT - 18); ctx.stroke();
    }

    ctx.fillStyle = this.C_TEXT; ctx.font = 'bold 12px Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CALENDAR WEEKS', this.PL + this.cW / 2, this.PT - 52);
  }

  _renderXAxis_weekly() {
    const { ctx } = this;
    const sd = this._startDate(), PERIOD = 20;
    const vs = this.viewStart, ve = vs + this.DAYS;

    ctx.fillStyle = this.C_TEXT; ctx.font = 'bold 10px Arial,sans-serif'; ctx.textAlign = 'center';
    const first10 = Math.ceil(vs / 10) * 10;
    for (let col = first10; col <= ve; col += 10) {
      ctx.fillText(String(col), this.colL(col), this.PT + this.cH + 15);
    }
    ctx.font = 'bold 11px Arial,sans-serif';
    ctx.fillText('SUCCESSIVE CALENDAR WEEKS', this.PL + this.cW / 2, this.PT + this.cH + 28);

    const firstP = Math.floor(vs / PERIOD) * PERIOD;
    for (let col = firstP; col <= ve + PERIOD; col += PERIOD) {
      const x = this.colL(col);
      if (x > this.PL + this.cW + 40) continue;
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, this.PT - 32); ctx.lineTo(x, this.PT - 20); ctx.stroke();
      ctx.textAlign = 'left';
      if (sd) {
        const dt = new Date(sd); dt.setDate(dt.getDate() + col * 7);
        const dd = String(dt.getDate()).padStart(2,'0');
        const mm = String(dt.getMonth()+1).padStart(2,'0');
        const yy = String(dt.getFullYear()).slice(-2);
        ctx.fillStyle = '#003344'; ctx.font = 'bold 10px Arial,sans-serif';
        ctx.fillText(`${dd} ${mm} ${yy}`, x + 4, this.PT - 22);
        ctx.fillStyle = this.C_TEXT;
      } else {
        ctx.fillStyle = this.C_TEXT; ctx.font = '9px Arial,sans-serif';
        ctx.fillText('Wk Mo Yr', x + 4, this.PT - 22);
      }
      const x2 = Math.min(this.colL(col + PERIOD), this.PL + this.cW);
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x, this.PT - 18); ctx.lineTo(x2, this.PT - 18); ctx.stroke();
    }

    ctx.fillStyle = this.C_TEXT; ctx.font = 'bold 12px Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CALENDAR WEEKS', this.PL + this.cW / 2, this.PT - 52);
  }

  _renderXAxis_monthly() {
    const { ctx } = this;
    const sd = this._startDate();
    const startYear = sd ? sd.getFullYear() : new Date().getFullYear();
    const MZC = this.MONTH_ZERO_COL;
    const vs = this.viewStart, ve = vs + this.DAYS;

    ctx.fillStyle = this.C_TEXT; ctx.font = 'bold 9px Arial,sans-serif'; ctx.textAlign = 'center';
    const first12 = Math.floor(vs / 12) * 12;
    for (let c = first12; c <= ve; c += 12) {
      ctx.fillText(String(c - MZC), this.colL(c), this.PT + this.cH + 15);
    }
    ctx.font = 'bold 11px Arial,sans-serif';
    ctx.fillText('SUCCESSIVE CALENDAR MONTHS', this.PL + this.cW / 2, this.PT + this.cH + 28);

    for (let c = first12; c <= ve + 12; c += 12) {
      const x = this.colL(c);
      if (x > this.PL + this.cW + 5) continue;
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, this.PT - 22); ctx.lineTo(x, this.PT - 8); ctx.stroke();
      if (c < ve + 12) {
        const midX    = this.colL(c) + this.dayW * 6;
        const yearOff = Math.floor((c - MZC) / 12);
        ctx.textAlign = 'center'; ctx.fillStyle = this.C_TEXT;
        ctx.font = 'bold 10px Arial,sans-serif';
        ctx.fillText(String(yearOff), midX, this.PT - 40);
        ctx.font = '9px Arial,sans-serif';
        ctx.fillText(String(startYear + yearOff), midX, this.PT - 28);
      }
    }

    ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(this.PL, this.PT - 8); ctx.lineTo(this.PL + this.cW, this.PT - 8); ctx.stroke();
    ctx.fillStyle = this.C_TEXT; ctx.font = 'bold 12px Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CALENDAR MONTHS', this.PL + this.cW / 2, this.PT - 58);
  }

  // ── Timing group dividers ─────────────────────────────────────────────────

  _drawTimingDividers() {
    const { ctx } = this;
    const sd = this._startDate();
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.PL, 0, this.cW, this.H);
    ctx.clip();
    this._timingGroups.forEach((g, i) => {
      const x1 = this.colL(g.startCol);
      const x2 = Math.min(this.colL(g.endCol + 1), this.PL + this.cW);
      if (i > 0) {
        ctx.strokeStyle = this.C_SUN; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x1, this.PT - 30); ctx.lineTo(x1, this.PT + this.cH); ctx.stroke();
      }
      let label;
      if (sd) {
        const dt = new Date(sd); dt.setDate(dt.getDate() + g.day);
        label = `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}/${String(dt.getFullYear()).slice(-2)}`;
      } else { label = `Day ${g.day}`; }
      ctx.fillStyle = '#003344'; ctx.font = 'bold 9px Arial,sans-serif';
      ctx.textAlign = 'left'; ctx.fillText(label, x1 + 3, this.PT - 20);
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x1, this.PT - 15); ctx.lineTo(x2, this.PT - 15); ctx.stroke();
    });
    ctx.restore();
  }

  // ── Footer ────────────────────────────────────────────────────────────────

  _drawFooterOnCanvas() {
    const { ctx } = this;
    const fields = ['organization','supervisor','counter','charter','environment','timer','correct','incorrect','neutral'];
    const labels = ['ORGANIZATION','SUPERVISOR','COUNTER','CHARTER','ENVIRONMENT','TIMER','CORRECT','INCORRECT','NEUTRAL'];
    const fw         = this.cW / fields.length;
    const yLabel     = this.PT + this.cH + 40;
    const yValue     = this.PT + this.cH + 52;
    const yUnderline = this.PT + this.cH + 55;
    fields.forEach((key, i) => {
      const x = this.PL + i * fw;
      ctx.fillStyle = this.C_TEXT; ctx.font = '7px Arial,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(labels[i], x + 2, yLabel);
      if (this.meta[key]) {
        ctx.fillStyle = '#003344'; ctx.font = '9px Arial,sans-serif';
        ctx.fillText(this.meta[key], x + 2, yValue);
      }
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x + 2, yUnderline); ctx.lineTo(x + fw - 4, yUnderline); ctx.stroke();
    });
  }

  _updateLegend() {
    const box = document.getElementById('legend-box');
    if (!box) return;
    const correct   = this.meta.correct   || 'Correct';
    const incorrect = this.meta.incorrect || 'Error';
    const dotSym = { circle: '●', square: '■', triangle: '▲', diamond: '◆' }[this.meta.dotShape || 'circle'] || '●';
    const xSym   = { x: '×', plus: '+', dash: '—', opencircle: '○' }[this.meta.xShape || 'x'] || '×';
    const dotColor = this.meta.dotColor || '#009933';
    const xColor   = this.meta.xColor   || '#cc0000';
    const rows = [
      { type: 'dot', symbol: dotSym, color: dotColor, label: correct },
      { type: 'x',   symbol: xSym,   color: xColor,   label: incorrect },
    ];
    if (this.meta.neutral) rows.push({ type: null, symbol: '—', color: '#666', label: this.meta.neutral });
    box.innerHTML = rows.map(r =>
      `<span class="legend-item${r.type ? ' legend-item--editable' : ''}" ${r.type ? `data-type="${r.type}"` : ''}><span class="legend-sym" style="color:${r.color}">${r.symbol}</span>${r.label}</span>`
    ).join('');
  }

  // ── Data point rendering ──────────────────────────────────────────────────

  _drawPoints() {
    const { ctx } = this;
    const pts = this._getPlottablePoints();

    if (this.chartType === 'timings' && this._timingGroups.length) {
      this._drawTimingDividers();
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(this.PL, this.PT, this.cW, this.cH); ctx.clip();

    pts.forEach(p => {
      if (this._isLineType(p.type)) {
        const dashed = p.type === 'intervention';
        if (dashed) {
          // white halo so dashes pop against grid lines
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 4.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(p.px, this.PT); ctx.lineTo(p.px, this.PT + this.cH); ctx.stroke();
        }
        ctx.strokeStyle = '#0055b3'; ctx.lineWidth = dashed ? 2.2 : 1.8;
        ctx.setLineDash(dashed ? [6, 4] : []);
        ctx.beginPath(); ctx.moveTo(p.px, this.PT); ctx.lineTo(p.px, this.PT + this.cH); ctx.stroke();
        ctx.setLineDash([]);
        if (p.note) {
          p.note.split('\n').forEach((ln, i) => {
            ctx.save();
            ctx.translate(p.px + 7 + i * 10, this.PT + 5);
            ctx.rotate(Math.PI / 2);
            ctx.fillStyle = '#0055b3';
            ctx.font = 'italic 9px Arial,sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(ln, 0, 0);
            ctx.restore();
          });
        }
      } else if (p.type === 'dot') {
        const color = this.meta.dotColor || '#009933';
        const shape = this.meta.dotShape || 'circle';
        const s = 4;
        ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        if (shape === 'square') {
          ctx.fillRect(p.px - s + 1, p.py - s + 1, (s - 1) * 2, (s - 1) * 2);
        } else {
          ctx.beginPath();
          if (shape === 'triangle') {
            ctx.moveTo(p.px, p.py - s); ctx.lineTo(p.px + s, p.py + s); ctx.lineTo(p.px - s, p.py + s);
          } else if (shape === 'diamond') {
            ctx.moveTo(p.px, p.py - s); ctx.lineTo(p.px + s, p.py); ctx.lineTo(p.px, p.py + s); ctx.lineTo(p.px - s, p.py);
          } else {
            ctx.arc(p.px, p.py, s - 1, 0, Math.PI * 2);
          }
          ctx.closePath(); ctx.fill();
        }
      } else if (p.type === 'x') {
        const color = this.meta.xColor || '#cc0000';
        const shape = this.meta.xShape || 'x';
        const s = 4.5;
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.setLineDash([]);
        if (shape === 'opencircle') {
          ctx.beginPath(); ctx.arc(p.px, p.py, s - 1, 0, Math.PI * 2); ctx.stroke();
        } else {
          ctx.beginPath();
          if (shape === 'plus') {
            ctx.moveTo(p.px, p.py - s); ctx.lineTo(p.px, p.py + s);
            ctx.moveTo(p.px - s, p.py); ctx.lineTo(p.px + s, p.py);
          } else if (shape === 'dash') {
            ctx.moveTo(p.px - s, p.py); ctx.lineTo(p.px + s, p.py);
          } else {
            ctx.moveTo(p.px - s, p.py - s); ctx.lineTo(p.px + s, p.py + s);
            ctx.moveTo(p.px + s, p.py - s); ctx.lineTo(p.px - s, p.py + s);
          }
          ctx.stroke();
        }
      }
    });

    ctx.restore();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  _isLineType(type) { return type === 'phase' || type === 'intervention'; }

  addPoint({ type, day, val, note = '', floor = null }) {
    const px = this._isLineType(type) ? this.xL(day) : this.xP(day);
    const py = this._isLineType(type) ? null : this.yP(val);
    this.points.push({ type, day, val, note, floor, px, py });
    this.draw();
  }

  removePoint(index) { this.points.splice(index, 1); this.draw(); }
  clearPoints()      { this.points = []; this.draw(); }
  undoLast()         { if (this.points.length) { this.points.pop(); this.draw(); } }
  getPoints()        { return [...this.points]; }

  setMeta(key, value) {
    if (key in this.meta) { this.meta[key] = value; this.draw(); }
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  _colLabel(pos) {
    const prefix = { timings: 'Msmt', daily: 'Day', weekly: 'Week', monthly: 'Month', count_per_day: 'Day' }[this.chartType] || 'Col';
    return `${prefix} ${pos}`;
  }

  _colToDateLabel(col) {
    const sd = this._startDate();
    if (!sd) return null;
    const fmt = dt => `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}/${String(dt.getFullYear()).slice(-2)}`;
    switch (this.chartType) {
      case 'daily':
      case 'count_per_day': {
        const dt = new Date(sd); dt.setDate(dt.getDate() + col);
        return fmt(dt);
      }
      case 'weekly': {
        const dt = new Date(sd); dt.setDate(dt.getDate() + col * 7);
        return fmt(dt);
      }
      case 'monthly': {
        const dt = new Date(sd); dt.setMonth(dt.getMonth() + (col - this.MONTH_ZERO_COL));
        return fmt(dt);
      }
      default: return null;
    }
  }

  _bindTooltip() {
    this.canvas.addEventListener('mousemove',  e => this._onMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => { this.tooltip.style.display = 'none'; this.canvas.style.cursor = ''; });
    this.canvas.addEventListener('click',      e => this._onCanvasClick(e));
    document.addEventListener('click', e => {
      const popup = document.getElementById('note-popup');
      if (popup && !popup.classList.contains('hidden') &&
          !popup.contains(e.target) && e.target !== this.canvas) {
        this._hideNotePopup();
      }
    });
  }

  _onMouseMove(e) {
    const rect   = this.canvas.getBoundingClientRect();
    const scaleX = this.W / rect.width;
    const scaleY = this.H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top)  * scaleY;

    if (!this.inChart(cx, cy)) { this.tooltip.style.display = 'none'; this.canvas.style.cursor = ''; return; }

    if (this.chartType === 'timings') {
      const hoverCol = Math.floor((cx - this.PL) / this.dayW) + this.viewStart;
      const onLine   = this._celerationLineHits.some(tr => hoverCol >= tr.startCol && hoverCol <= tr.endCol);
      this.canvas.style.cursor = onLine ? 'pointer' : '';
    } else {
      this.canvas.style.cursor = '';
    }

    const col  = this.xToDay(cx);
    const fmt  = v => v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= 0.1 ? v.toFixed(3) : v.toFixed(4);

    const pts    = this._getPlottablePoints();
    const nearby = pts.find(p =>
      !this._isLineType(p.type) && p.py != null && Math.abs(p.px - cx) < 10 && Math.abs(p.py - cy) < 10
    );

    const dateStr = this._colToDateLabel(col);
    const nearbyValLabel = nearby
      ? (this.chartType === 'count_per_day' ? Math.round(nearby.val) : `${fmt(nearby.val)}/min`) +
        (nearby.note ? ' — ' + nearby.note : '')
      : null;
    this.tooltip.textContent = nearbyValLabel !== null
      ? `${this._colLabel(nearby.day)} · ${nearbyValLabel}`
      : dateStr
        ? `${this._colLabel(col)} · ${dateStr}`
        : this._colLabel(col);

    this.tooltip.style.left    = (e.clientX - rect.left + 10) + 'px';
    this.tooltip.style.top     = (e.clientY - rect.top  - 30) + 'px';
    this.tooltip.style.display = 'block';
  }

  // ── Note carets ───────────────────────────────────────────────────────────

  _getNotePoints() {
    const hasNote = n => n && n.trim() && !/^\(\d+\)$/.test(n);

    if (this.chartType === 'daily' || this.chartType === 'timings') {
      return this._getPlottablePoints()
        .filter(p => !this._isLineType(p.type) && hasNote(p.note))
        .map(p => ({ px: p.px, note: p.note, type: p.type, day: p.day, val: p.val }));
    }

    // weekly/monthly/count_per_day: notes may be stripped by aggregation — use raw points
    return this.points
      .filter(p => !this._isLineType(p.type) && hasNote(p.note))
      .map(p => {
        let px;
        if (this.chartType === 'count_per_day') {
          px = this.colC(p.day);
        } else if (this.chartType === 'weekly') {
          px = this.colC(Math.floor(p.day / 7));
        } else {
          px = this.colC(this.monthToCol(this._monthOffsetOf(p.day)));
        }
        return { px, note: p.note, type: p.type, day: p.day, val: p.val };
      });
  }

  _drawNoteCarets() {
    const { ctx } = this;
    const notePts = this._getNotePoints();
    if (!notePts.length) return;

    // Group overlapping x positions into one caret
    const byX = new Map();
    notePts.forEach(p => {
      const key = Math.round(p.px);
      if (!byX.has(key)) byX.set(key, []);
      byX.get(key).push(p);
    });

    const tipY  = this.PT - 3;
    const baseY = tipY - 9;
    const halfW = 5;

    byX.forEach(pts => {
      const px = pts[0].px;
      if (px < this.PL - 6 || px > this.PL + this.cW + 6) return;

      ctx.fillStyle = '#ff8c00';
      ctx.beginPath();
      ctx.moveTo(px - halfW, baseY);
      ctx.lineTo(px + halfW, baseY);
      ctx.lineTo(px, tipY);
      ctx.closePath();
      ctx.fill();

      this._noteCarets.push({ px, baseY, tipY, halfW, pts });
    });
  }

  _onCanvasClick(e) {
    const rect   = this.canvas.getBoundingClientRect();
    const scaleX = this.W / rect.width;
    const scaleY = this.H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top)  * scaleY;

    const caretHit = this._noteCarets.find(c =>
      Math.abs(cx - c.px) <= c.halfW + 4 && cy >= c.baseY - 4 && cy <= c.tipY + 4
    );

    if (caretHit) {
      e.stopPropagation();
      this._showNotePopup(caretHit.pts, e.clientX - rect.left, e.clientY - rect.top);
      return;
    }

    this._hideNotePopup();

    if (this.chartType === 'timings' && this.inChart(cx, cy)) {
      const clickCol = Math.floor((cx - this.PL) / this.dayW) + this.viewStart;
      const lineHit  = this._celerationLineHits.find(tr => clickCol >= tr.startCol && clickCol <= tr.endCol);
      if (lineHit) {
        this._showTimingDayCeleration(lineHit);
      } else {
        document.getElementById('slope-box').innerHTML = '';
      }
    }
  }

  _showTimingDayCeleration(tr) {
    const box = document.getElementById('slope-box');
    if (!box) return;

    const fmtFactor = reg => {
      if (!reg || reg.m === null) return '—';
      const factor = Math.pow(10, reg.m);
      if (Math.abs(factor - 1) < 0.005) return '×1.00/pt';
      if (factor > 1) return '×' + (factor >= 10 ? factor.toFixed(1) : factor.toFixed(2)) + '/pt';
      const inv = 1 / factor;
      return '÷' + (inv >= 10 ? inv.toFixed(1) : inv.toFixed(2)) + '/pt';
    };

    const fmtBounce = reg => {
      if (!reg || reg.bounce == null) return '—';
      const b = reg.bounce;
      return '×' + (b >= 10 ? b.toFixed(1) : b.toFixed(2));
    };

    const sd = this._startDate();
    let dateStr = `Day ${tr.day}`;
    if (sd) {
      const dt = new Date(sd);
      dt.setDate(dt.getDate() + tr.day);
      dateStr = `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}/${String(dt.getFullYear()).slice(-2)}`;
    }

    const item = (reg, label, color) => `
      <div class="slope-item">
        <span class="slope-label" style="color:${color}">${label}</span>
        <div class="slope-row">
          <span class="slope-sub-label">Celeration</span>
          <span class="slope-val" style="color:${color}">${fmtFactor(reg)}</span>
        </div>
        <div class="slope-row">
          <span class="slope-sub-label">Bounce</span>
          <span class="slope-val" style="color:${color}">${fmtBounce(reg)}</span>
        </div>
        <span class="slope-n">${reg ? reg.n : 0} pt${reg && reg.n === 1 ? '' : 's'}</span>
      </div>`;

    box.innerHTML =
      `<span class="slope-date-label">${dateStr}</span>` +
      item(tr.dot, 'Successes', this.C_REG_DOT) +
      item(tr.x,   'Errors',    this.C_REG_X);
  }

  _showNotePopup(pts, localX, localY) {
    const popup = document.getElementById('note-popup');
    if (!popup) return;

    const sd = this._startDate();
    const fmt = v => v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= 0.1 ? v.toFixed(3) : v.toFixed(4);

    const dayLabel = (p) => {
      if (this.chartType === 'timings') return `Measurement ${p.day}`;
      if (!sd) return `Day ${p.day}`;
      const dt = new Date(sd); dt.setDate(dt.getDate() + p.day);
      return `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}/${String(dt.getFullYear()).slice(-2)}`;
    };

    const entries = pts.map(p => `
      <div class="note-popup-entry">
        <div class="note-popup-point">
          <span class="note-popup-icon note-popup-icon--${p.type}">${p.type === 'dot' ? '●' : '×'}</span>
          <span>${p.type === 'dot' ? 'Correct' : 'Error'} &middot; ${dayLabel(p)} &middot; ${this.chartType === 'count_per_day' ? Math.round(p.val) : `${fmt(p.val)}/min`}</span>
        </div>
        <div class="note-popup-text">&ldquo;${p.note}&rdquo;</div>
      </div>`).join('');

    popup.innerHTML = `
      <button class="note-popup-close" id="note-popup-close">&times;</button>
      ${entries}`;

    document.getElementById('note-popup-close').addEventListener('click', e => {
      e.stopPropagation(); this._hideNotePopup();
    });

    popup.classList.remove('hidden');

    // Position below the caret, clamped to wrap width
    const wrap = popup.parentElement;
    const maxLeft = wrap.clientWidth - popup.offsetWidth - 8;
    popup.style.left = Math.max(4, Math.min(localX - 10, maxLeft)) + 'px';
    popup.style.top  = (localY + 14) + 'px';
  }

  _hideNotePopup() {
    const popup = document.getElementById('note-popup');
    if (popup) popup.classList.add('hidden');
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  exportCSV(domainName) {
    const colHeader = { timings: 'Measurement', daily: 'Day', weekly: 'Week', monthly: 'Month', count_per_day: 'Day' }[this.chartType] || 'Day';
    const valHeader = this.chartType === 'count_per_day' ? 'Count' : 'Count/Min';
    const rows = [['Type', colHeader, valHeader, 'Note']];
    [...this.points].sort((a, b) => a.day - b.day).forEach(p => {
      rows.push([p.type, p.day, p.val ?? '', p.note ?? '']);
    });
    const csv  = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `scc-${domainName.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
  }
}
