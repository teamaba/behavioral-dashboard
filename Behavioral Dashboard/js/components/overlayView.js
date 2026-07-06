/**
 * overlayView.js — Overlay Comparison screen
 * Read-only view: renders a primary chart plus up to 3 comparison charts,
 * side by side on their own SCCChart instance (never the editable dashboard
 * chart). Only the visual style of each overlaid chart and image export are
 * editable here — no log entry, no chart metadata, no goals, no data edits.
 */

const OVERLAY_VIEW_DOT_SHAPES = [
  { value: 'circle',   sym: '●' },
  { value: 'square',   sym: '■' },
  { value: 'triangle', sym: '▲' },
  { value: 'diamond',  sym: '◆' },
];
const OVERLAY_VIEW_X_SHAPES = [
  { value: 'x',          sym: '×' },
  { value: 'plus',       sym: '+' },
  { value: 'dash',       sym: '—' },
  { value: 'opencircle', sym: '○' },
];

class OverlayView {
  constructor() {
    this.view  = document.getElementById('overlay-view');
    this.chart = new SCCChart('overlay-view-canvas', 'overlay-view-tooltip', 'overlay-view-note-popup');
    this.chart.afterDraw = () => this._renderLegend();
    this._primaryLabel = '';

    document.getElementById('overlay-view-back').addEventListener('click', () => this.hide());
    document.getElementById('overlay-view-export').addEventListener('click', () => this._exportImage());
    document.getElementById('ov-scroll-left').addEventListener('click', () => this.chart.scrollBy(-this.chart._scrollStep()));
    document.getElementById('ov-scroll-right').addEventListener('click', () => this.chart.scrollBy(this.chart._scrollStep()));
    document.getElementById('ov-scroll-home').addEventListener('click', () => this.chart.scrollHome());
  }

  /**
   * primary: { points, meta, label }
   * overlays: array (up to 3, may contain gaps) of { behaviorId, domainId, label, rawPoints, ownMeta, style }
   * overlayAlign: 'relative' | 'calendar'
   */
  show(primary, overlays, overlayAlign) {
    this._primaryLabel = primary.label;
    document.getElementById('overlay-view-title').textContent = primary.label;

    this.chart.points = primary.points;
    this.chart.meta   = Object.assign({
      dotColor: '#009933', dotShape: 'circle',
      xColor:   '#cc0000', xShape:   'x',
      acceltarget: '', deceltarget: '', startDate: '',
    }, primary.meta || {});

    // Real aim values are kept aside so the "show aim band" checkbox can
    // toggle them off/on without losing them.
    const aimLo = primary.meta?.aim_low  != null ? parseFloat(primary.meta.aim_low)  : NaN;
    const aimHi = primary.meta?.aim_high != null ? parseFloat(primary.meta.aim_high) : NaN;
    this._primaryAim = { low: isNaN(aimLo) ? null : aimLo, high: isNaN(aimHi) ? null : aimHi };

    // Session-only style overrides for the primary chart (same editable
    // aspects as an overlay) — never written back to its real chart_meta.
    this.primaryStyle = {
      dotColor: this.chart.meta.dotColor || '#009933',
      dotShape: this.chart.meta.dotShape || 'circle',
      xColor:   this.chart.meta.xColor   || '#cc0000',
      xShape:   this.chart.meta.xShape   || 'x',
      aimColor: '#f5c500',
      showTrendlines: true,
      showPhaseLines: false,
      showAimBand: true,
    };

    this.chart.viewStart = 0;
    this.chart.overlays = overlays;
    this.chart.overlayAlign = overlayAlign;

    this._applyPrimaryStyle();
    this.chart.draw();
    this._renderStylePanel();

    window.hierarchyView?.hide();
    document.getElementById('app-root').style.display = 'none';
    this.view.classList.remove('hidden');
  }

  _applyPrimaryStyle() {
    const s = this.primaryStyle;
    this.chart.meta.dotColor = s.dotColor;
    this.chart.meta.dotShape = s.dotShape;
    this.chart.meta.xColor   = s.xColor;
    this.chart.meta.xShape   = s.xShape;
    this.chart.C_AIM         = s.aimColor;
    this.chart.showTrendlines = s.showTrendlines;
    this.chart.showPhaseLines = s.showPhaseLines;
    this.chart.aimLow  = s.showAimBand ? this._primaryAim.low  : null;
    this.chart.aimHigh = s.showAimBand ? this._primaryAim.high : null;
  }

  hide() {
    this.view.classList.add('hidden');
    window.showHierarchyView?.();
  }

  // ── Legend ────────────────────────────────────────────────────────────────

  _renderLegend() {
    const box = document.getElementById('overlay-view-legend');
    if (!box) return;
    const rows = [{
      label: this._primaryLabel || 'Primary',
      dotColor: this.chart.meta.dotColor || '#009933',
      xColor:   this.chart.meta.xColor   || '#cc0000',
    }].concat(this.chart.overlays.filter(Boolean).map(ov => ({
      label: ov.label, dotColor: ov.style.dotColor, xColor: ov.style.xColor,
    })));
    box.innerHTML = rows.map(r => `
      <span class="legend-item">
        <span class="legend-sym" style="color:${r.dotColor}">●</span>
        <span class="legend-sym" style="color:${r.xColor}">×</span>
        ${_esc(r.label)}
      </span>`).join('');
  }

  // ── Style panel — primary + each active overlay, same editable aspects ────
  // (view/style + export only — never touches any chart's real saved data)

  _getStyle(slotKey) {
    return slotKey === 'primary' ? this.primaryStyle : this.chart.overlays[Number(slotKey)]?.style;
  }

  _renderStylePanel() {
    const section = document.getElementById('overlay-style-section');
    if (!section) return;
    const blocks = [this._styleCardHTML('primary', this._primaryLabel, this.primaryStyle)];
    this.chart.overlays.forEach((ov, i) => {
      if (ov) blocks.push(this._styleCardHTML(String(i), ov.label, ov.style));
    });
    section.innerHTML = blocks.join('');
    this._bindStyleCard('primary');
    this.chart.overlays.forEach((ov, i) => { if (ov) this._bindStyleCard(String(i)); });
  }

  _styleCardHTML(slotKey, label, s) {
    const dotShapeBtns = OVERLAY_VIEW_DOT_SHAPES.map(sh =>
      `<button class="marker-shape-btn overlay-shape-btn${s.dotShape === sh.value ? ' active' : ''}" data-slot="${slotKey}" data-kind="dot" data-shape="${sh.value}">${sh.sym}</button>`).join('');
    const xShapeBtns = OVERLAY_VIEW_X_SHAPES.map(sh =>
      `<button class="marker-shape-btn overlay-shape-btn${s.xShape === sh.value ? ' active' : ''}" data-slot="${slotKey}" data-kind="x" data-shape="${sh.value}">${sh.sym}</button>`).join('');

    return `
      <div class="overlay-style-panel overlay-style-card" data-slot="${slotKey}">
        <div class="overlay-style-label">${_esc(label)}${slotKey === 'primary' ? ' <span class="overlay-style-primary-tag">Primary</span>' : ''}</div>
        <div class="overlay-style-row">
          <div class="overlay-style-col">
            <label class="marker-popup-label">Success color</label>
            <input type="color" class="overlay-color-input" data-slot="${slotKey}" data-kind="dotColor" value="${s.dotColor}">
            <div class="marker-shape-grid overlay-shape-grid">${dotShapeBtns}</div>
          </div>
          <div class="overlay-style-col">
            <label class="marker-popup-label">Error color</label>
            <input type="color" class="overlay-color-input" data-slot="${slotKey}" data-kind="xColor" value="${s.xColor}">
            <div class="marker-shape-grid overlay-shape-grid">${xShapeBtns}</div>
          </div>
          <div class="overlay-style-col">
            <label class="marker-popup-label">Aim band color</label>
            <input type="color" class="overlay-color-input" data-slot="${slotKey}" data-kind="aimColor" value="${s.aimColor}">
          </div>
        </div>
        <div class="overlay-checkbox-row">
          <label><input type="checkbox" class="overlay-check" data-slot="${slotKey}" data-kind="showTrendlines" ${s.showTrendlines ? 'checked' : ''}> Show trendlines</label>
          <label><input type="checkbox" class="overlay-check" data-slot="${slotKey}" data-kind="showPhaseLines" ${s.showPhaseLines ? 'checked' : ''}> Show phase/intervention lines</label>
          <label><input type="checkbox" class="overlay-check" data-slot="${slotKey}" data-kind="showAimBand" ${s.showAimBand ? 'checked' : ''}> Show aim band</label>
        </div>
      </div>`;
  }

  _bindStyleCard(slotKey) {
    const section = document.getElementById('overlay-style-section');
    section.querySelectorAll(`.overlay-color-input[data-slot="${slotKey}"]`).forEach(inp => {
      inp.addEventListener('input', () => this._applyStyle(slotKey, inp.dataset.kind, inp.value));
    });
    section.querySelectorAll(`.overlay-check[data-slot="${slotKey}"]`).forEach(inp => {
      inp.addEventListener('change', () => this._applyStyle(slotKey, inp.dataset.kind, inp.checked));
    });
    section.querySelectorAll(`.overlay-shape-btn[data-slot="${slotKey}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.kind === 'dot' ? 'dotShape' : 'xShape';
        section.querySelectorAll(`.overlay-shape-btn[data-slot="${slotKey}"][data-kind="${btn.dataset.kind}"]`)
          .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._applyStyle(slotKey, kind, btn.dataset.shape);
      });
    });
  }

  _applyStyle(slotKey, kind, value) {
    const style = this._getStyle(slotKey);
    if (!style) return;
    style[kind] = value;
    if (slotKey === 'primary') {
      this._applyPrimaryStyle();
    } else {
      if (kind === 'dotColor') style.trendDotColor = value;
      if (kind === 'xColor')   style.trendXColor   = value;
    }
    this.chart.draw();
  }

  // ── Export ────────────────────────────────────────────────────────────────

  _exportImage() {
    const sourceCanvas = document.getElementById('overlay-view-canvas');
    if (!sourceCanvas) return;

    const rows = [{
      label: this._primaryLabel || 'Primary',
      dotColor: this.chart.meta.dotColor || '#009933',
      xColor:   this.chart.meta.xColor   || '#cc0000',
    }].concat(this.chart.overlays.filter(Boolean).map(ov => ({
      label: ov.label, dotColor: ov.style.dotColor, xColor: ov.style.xColor,
    })));

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
      a.download = 'chart-overlay.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }
}
