/**
 * scc.js — Standard Celeration Chart component
 * Renders an authentic blue-grid SCC on a <canvas> element.
 */

class SCCChart {
  constructor(canvasId, tooltipId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.tooltip = document.getElementById(tooltipId);
    this.points = [];

    // Chart metadata (editable via footer fields in HTML)
    this.meta = {
      supervisor: '', adviser: '', manager: '',
      timer: '', counter: '', performer: '',
      age: '', label: '', counted: ''
    };

    // Canvas internal resolution — wide enough for fan to breathe
    this.W = 1010;
    this.H = 630;
    this.canvas.width = this.W;
    this.canvas.height = this.H;

    // Chart padding — extra left room for fan, extra top for header
    this.PL = 78;
    this.PR = 60;
    this.PT = 88;
    this.PB = 58;

    this.cW = this.W - this.PL - this.PR;
    this.cH = this.H - this.PT - this.PB;

    this.DAYS = 140;
    this.dayW = this.cW / this.DAYS;

    this.LOG_MIN = -3;
    this.LOG_MAX = 3;
    this.LOG_RANGE = 6;

    // Classic cyan-blue SCC palette
    this.C_CYCLE = '#00bcd4';
    this.C_FIVE  = '#33ccdd';
    this.C_MINOR = '#99e6f0';
    this.C_SUN   = '#008faa';
    this.C_DAY   = '#aaebf5';
    this.C_TEXT  = '#0099cc';

    this._bindTooltip();
    this.draw();
  }

  // ── Coordinate helpers ──────────────────────────────────────────────────

  yP(v) {
    if (!v || v <= 0) return this.PT + this.cH + 20;
    const l = Math.max(this.LOG_MIN, Math.min(this.LOG_MAX, Math.log10(v)));
    return this.PT + this.cH - ((l - this.LOG_MIN) / this.LOG_RANGE) * this.cH;
  }

  xL(d) { return this.PL + d * this.dayW; }
  xP(d) { return this.PL + (d + 0.5) * this.dayW; }

  yToVal(py) {
    const frac = (this.PT + this.cH - py) / this.cH;
    return Math.pow(10, this.LOG_MIN + frac * this.LOG_RANGE);
  }

  xToDay(px) {
    return Math.max(0, Math.min(139, Math.floor((px - this.PL) / this.dayW)));
  }

  inChart(x, y) {
    return x >= this.PL && x <= this.PL + this.cW &&
           y >= this.PT && y <= this.PT + this.cH;
  }

  // ── Main draw ────────────────────────────────────────────────────────────

  draw() {
    this._drawGrid();
    this._drawPoints();
  }

  _drawGrid() {
    const { ctx, W, H, PL, PT, cW, cH } = this;

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
    // Top boundary (1000 line)
    ctx.strokeStyle = this.C_CYCLE; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(PL, this.yP(1000)); ctx.lineTo(PL + cW, this.yP(1000)); ctx.stroke();

    // Vertical day lines
    for (let d = 0; d <= this.DAYS; d++) {
      const x = this.xL(d);
      const isSun = d % 7 === 0;
      ctx.strokeStyle = isSun ? this.C_SUN : this.C_DAY;
      ctx.lineWidth   = isSun ? 1.4 : 0.45;
      ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + cH); ctx.stroke();
    }

    // Border
    ctx.strokeStyle = this.C_CYCLE; ctx.lineWidth = 1.8;
    ctx.strokeRect(PL, PT, cW, cH);

    this._drawYLabels();
    this._drawXLabels();
    this._drawAxisTitles();
    this._drawCelerationFan();
    this._drawFooterOnCanvas();
  }

  _drawYLabels() {
    const { ctx } = this;
    const labels = [
      [1000,'1000',true],[500,'500',false],[200,'200',false],
      [100,'100',true],[50,'50',false],[20,'20',false],
      [10,'10',true],[5,'5',false],[2,'2',false],
      [1,'1',true],[0.5,'.5',false],[0.2,'.2',false],
      [0.1,'.1',true],[0.05,'.05',false],[0.02,'.02',false],
      [0.01,'.01',true],[0.005,'.005',false],[0.002,'.002',false],
      [0.001,'.001',true]
    ];
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

  _drawXLabels() {
    const { ctx } = this;

    // Bottom day numbers: 0, 14, 28 ... 140
    ctx.fillStyle = this.C_TEXT;
    ctx.font = 'bold 10px Arial,sans-serif';
    ctx.textAlign = 'center';
    for (let d = 0; d <= this.DAYS; d += 14) {
      ctx.fillText(String(d), this.xL(d), this.PT + this.cH + 15);
    }

    // Top week numbers: 0, 4, 8 ... 20
    ctx.font = '10px Arial,sans-serif';
    for (let w = 0; w <= 20; w += 4) {
      const x = this.xL(w * 7);
      ctx.textAlign = 'center';
      ctx.fillText(String(w), x, this.PT - 36);
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, this.PT - 32); ctx.lineTo(x, this.PT - 24); ctx.stroke();
    }

    // "Dy Mo Yr" date fields — below week numbers, above chart
    ctx.font = '7px Arial,sans-serif';
    [0, 28, 56, 84, 112, 140].forEach(d => {
      const x   = this.xL(d);
      const mid = x + this.dayW * 3.5;
      ctx.textAlign = 'center';
      ctx.fillText('Dy Mo Yr', mid, this.PT - 14);
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x, this.PT - 18); ctx.lineTo(x + this.dayW * 7, this.PT - 18); ctx.stroke();
    });

    // Day letters on first week only — positioned below Dy Mo Yr underline
    const dl = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    ctx.font = '7px Arial,sans-serif';
    for (let d = 0; d < 7; d++) {
      ctx.textAlign = 'center';
      ctx.fillText(dl[d], this.xL(d) + this.dayW * 0.5, this.PT - 6);
    }
  }

  _drawAxisTitles() {
    const { ctx } = this;

    // Y axis title
    ctx.save();
    ctx.translate(13, this.PT + this.cH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = this.C_TEXT;
    ctx.font = 'bold 11px Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('COUNT PER MINUTE', 0, 0);
    ctx.restore();

    // X axis title
    ctx.fillStyle = this.C_TEXT;
    ctx.font = 'bold 11px Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SUCCESSIVE CALENDAR DAYS', this.PL + this.cW / 2, this.PT + this.cH + 28);

    // Calendar weeks label — well above week numbers
    ctx.font = 'bold 12px Arial,sans-serif';
    ctx.fillText('CALENDAR WEEKS', this.PL + this.cW / 2, this.PT - 52);
  }

  _drawCelerationFan() {
    const { ctx } = this;

    // Fan origin: above the chart, left of the grid — matches original SCC layout
    const fx = this.PL - 72;
    const fy = this.PT - 42;

    const lines = [
      { l: '×16',  a: -58 },
      { l: '×4',   a: -46 },
      { l: '×2',   a: -36 },
      { l: '×1.4', a: -27 },
      { l: '×1.0', a: -18 }
    ];
    const len = 48;

    lines.forEach(({ l, a }) => {
      const rad = a * Math.PI / 180;
      const ex  = fx + Math.cos(rad) * len;
      const ey  = fy + Math.sin(rad) * len;
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = this.C_TEXT; ctx.font = '7px Arial,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(l, ex + 2, ey + 3);
    });

    ctx.fillStyle = this.C_TEXT; ctx.font = 'bold 7px Arial,sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('TM', fx + 2, fy - 5);
    ctx.font = '6.5px Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('per week', fx, fy + 16);
  }

  // Footer values drawn on canvas from this.meta
  _drawFooterOnCanvas() {
    const { ctx } = this;
    const fields = ['supervisor','adviser','manager','timer','counter','performer','age','label','counted'];
    const labels = ['SUPERVISOR','ADVISER','MANAGER','TIMER','COUNTER','PERFORMER','AGE','LABEL','COUNTED'];
    const fw = this.cW / fields.length;
    const yLabel    = this.PT + this.cH + 40; // field name label
    const yValue    = this.PT + this.cH + 52; // autofill / typed value
    const yUnderline = this.PT + this.cH + 55; // underline below value

    fields.forEach((key, i) => {
      const x = this.PL + i * fw;
      // Field label (small, above the line)
      ctx.fillStyle = this.C_TEXT;
      ctx.font = '7px Arial,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(labels[i], x + 2, yLabel);
      // Typed value (larger, between label and underline)
      if (this.meta[key]) {
        ctx.fillStyle = '#003344';
        ctx.font = '9px Arial,sans-serif';
        ctx.fillText(this.meta[key], x + 2, yValue);
      }
      // Underline
      ctx.strokeStyle = this.C_TEXT; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x + 2, yUnderline); ctx.lineTo(x + fw - 4, yUnderline); ctx.stroke();
    });


  }

  // ── Data points ──────────────────────────────────────────────────────────

  _drawPoints() {
    const { ctx } = this;
    const sorted = [...this.points].sort((a, b) => a.day - b.day);

    // Connecting lines, broken at phase changes
    let seg = [];
    sorted.forEach(p => {
      if (p.type === 'phase') { this._drawSegment(seg); seg = []; }
      else if (p.type === 'dot') seg.push(p);
    });
    this._drawSegment(seg);

    sorted.forEach(p => {
      if (p.type === 'phase') {
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1.8; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(p.px, this.PT); ctx.lineTo(p.px, this.PT + this.cH); ctx.stroke();
        if (p.note) {
          ctx.fillStyle = '#111'; ctx.font = 'italic 8px Arial,sans-serif'; ctx.textAlign = 'left';
          p.note.split('\n').forEach((ln, i) => ctx.fillText(ln, p.px + 3, this.PT + 14 + i * 11));
        }
      } else if (p.type === 'dot') {
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(p.px, p.py, 3, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'x') {
        const s = 4.5;
        ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(p.px - s, p.py - s); ctx.lineTo(p.px + s, p.py + s);
        ctx.moveTo(p.px + s, p.py - s); ctx.lineTo(p.px - s, p.py + s);
        ctx.stroke();
      }
    });
  }

  _drawSegment(seg) {
    if (seg.length < 2) return;
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(seg[0].px, seg[0].py);
    seg.slice(1).forEach(p => ctx.lineTo(p.px, p.py));
    ctx.stroke();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  addPoint({ type, day, val, note = '' }) {
    const px = type === 'phase' ? this.xL(day) + this.dayW * 0.5 : this.xP(day);
    const py = type === 'phase' ? null : this.yP(val);
    this.points.push({ type, day, val, note, px, py });
    this.draw();
  }

  removePoint(index) {
    this.points.splice(index, 1);
    this.draw();
  }

  clearPoints() {
    this.points = [];
    this.draw();
  }

  undoLast() {
    if (this.points.length) { this.points.pop(); this.draw(); }
  }

  getPoints() { return [...this.points]; }

  setMeta(key, value) {
    if (key in this.meta) { this.meta[key] = value; this.draw(); }
  }

  // ── Tooltip ──────────────────────────────────────────────────────────────

  _bindTooltip() {
    this.canvas.addEventListener('mousemove', e => this._onMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => { this.tooltip.style.display = 'none'; });
  }

  _onMouseMove(e) {
    const rect   = this.canvas.getBoundingClientRect();
    const scaleX = this.W / rect.width;
    const scaleY = this.H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top)  * scaleY;

    if (!this.inChart(cx, cy)) { this.tooltip.style.display = 'none'; return; }

    const day = this.xToDay(cx);
    const val = this.yToVal(cy);

    const nearby = this.points.find(p =>
      p.type !== 'phase' && Math.abs(p.px - cx) < 10 && Math.abs(p.py - cy) < 10
    );

    const fmt = v => v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= 0.1 ? v.toFixed(3) : v.toFixed(4);

    this.tooltip.textContent = nearby
      ? `Day ${nearby.day} · ${fmt(nearby.val)}/min${nearby.note ? ' — ' + nearby.note : ''}`
      : `Day ${day} · ${fmt(val)}/min`;

    this.tooltip.style.left    = (e.clientX - rect.left + 10) + 'px';
    this.tooltip.style.top     = (e.clientY - rect.top  - 30) + 'px';
    this.tooltip.style.display = 'block';
  }

  // ── CSV export ───────────────────────────────────────────────────────────

  exportCSV(domainName) {
    const rows = [['Type','Day','Count/min','Note']];
    [...this.points].sort((a,b) => a.day - b.day).forEach(p => {
      rows.push([p.type, p.day, p.val ?? '', p.note ?? '']);
    });
    const csv  = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `scc-${domainName.replace(/\s+/g,'-').toLowerCase()}.csv`;
    a.click();
  }
}
