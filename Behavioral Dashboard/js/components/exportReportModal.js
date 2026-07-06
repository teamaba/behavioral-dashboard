/**
 * exportReportModal.js — PDF Progress Report export
 * A standalone menu (opened from the Overview page) for generating a
 * printable multi-page PDF for one athlete: a cover page, a plain table of
 * contents (skill/domain + page number, nothing else), and one full detail
 * page per selected skill/domain with the chart, a Program Review box, and
 * blank space for handwritten comments.
 * Read-only — this only renders already-accessible data, nothing is saved.
 */

class ExportReportModal {
  constructor() {
    this.chart = new SCCChart('report-render-canvas', 'report-render-tooltip');
    this._teams = [];
    this._participants = [];
    this._domains = [];
    this._behaviors = [];
    this._loaded = false;
    this._generating = false;
    this._render();
  }

  async show() {
    this.overlay.classList.remove('hidden');
    if (!this._loaded) {
      try { await this._loadHierarchy(); }
      catch (err) { console.error('[ExportReportModal]', err); }
    }
    this._feedback('', false);
    this._renderAthleteSelects();
    this._renderDomainChecks();
    this._renderSkillChecks([]);
  }

  hide() { this.overlay.classList.add('hidden'); }

  async _loadHierarchy() {
    const [teams, participants, domains] = await Promise.all([
      DB.teams.getAll(), DB.participants.getAll(), DB.domains.getAll(),
    ]);
    this._teams = teams || [];
    this._participants = participants || [];
    this._domains = domains || [];
    this._loaded = true;
  }

  // ── Markup ──────────────────────────────────────────────────────────────

  _render() {
    this.overlay = document.getElementById('export-report-modal-overlay');
    this.overlay.innerHTML = `
      <div class="login-card overlay-modal-card">
        <button class="invite-close" id="report-modal-close">&#x2715;</button>
        <div class="login-mode-label">Export Progress Report</div>

        <div class="overlay-primary-section">
          <label class="manage-section-label">Athlete</label>
          <div class="report-athlete-selects">
            <select class="invite-select" id="report-team"></select>
            <select class="invite-select" id="report-participant"></select>
          </div>
        </div>

        <label class="manage-section-label">Domains to include</label>
        <div class="overlay-checkbox-row" id="report-domain-checks"></div>

        <label class="manage-section-label" style="margin-top:14px">Skills to include</label>
        <div class="report-skill-checks" id="report-skill-checks">
          <p class="hv-notify-empty">Choose an athlete first.</p>
        </div>

        <div class="overlay-modal-actions">
          <button class="login-btn overlay-view-btn" id="report-generate-btn">Generate PDF</button>
        </div>
        <div class="login-feedback" id="report-feedback"></div>
      </div>
    `;

    document.getElementById('report-modal-close').addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.hide(); });

    const teamSel = document.getElementById('report-team');
    const partSel = document.getElementById('report-participant');
    teamSel.addEventListener('change', () => {
      partSel.innerHTML = this._participantOptionsHTML(teamSel.value, '');
      this._renderSkillChecks([]);
    });
    partSel.addEventListener('change', () => this._onParticipantChange());

    document.getElementById('report-generate-btn').addEventListener('click', () => this._generate());
  }

  _teamOptionsHTML(selectedId) {
    const opts = ['<option value="">Team…</option>'];
    this._teams.forEach(t => opts.push(`<option value="${t.id}"${String(t.id) === String(selectedId) ? ' selected' : ''}>${_esc(t.name)}</option>`));
    return opts.join('');
  }

  _participantOptionsHTML(teamId, selectedId) {
    const opts = ['<option value="">Athlete…</option>'];
    this._participants
      .filter(p => !teamId || String(p.team_id) === String(teamId))
      .forEach(p => opts.push(`<option value="${p.id}"${String(p.id) === String(selectedId) ? ' selected' : ''}>${_esc(p.name)}</option>`));
    return opts.join('');
  }

  _renderAthleteSelects() {
    const teamSel = document.getElementById('report-team');
    const partSel = document.getElementById('report-participant');
    teamSel.innerHTML = this._teamOptionsHTML('');
    partSel.innerHTML = this._participantOptionsHTML('', '');
  }

  _renderDomainChecks() {
    const box = document.getElementById('report-domain-checks');
    box.innerHTML = this._domains.map(d => `
      <label><input type="checkbox" class="report-domain-check" value="${_esc(d.id)}" checked> ${_esc(d.name)}</label>
    `).join('');
  }

  _renderSkillChecks(behaviors) {
    const box = document.getElementById('report-skill-checks');
    if (!behaviors.length) {
      box.innerHTML = '<p class="hv-notify-empty">Choose an athlete first.</p>';
      return;
    }
    box.innerHTML = behaviors.map(b => `
      <label class="report-skill-check-row"><input type="checkbox" class="report-skill-check" value="${_esc(b.id)}" data-name="${_esc(b.name)}" checked> ${_esc(b.name)}</label>
    `).join('');
  }

  async _onParticipantChange() {
    const pid = document.getElementById('report-participant').value;
    if (!pid) { this._renderSkillChecks([]); return; }
    this._feedback('Loading skills…', false);
    try {
      const behaviors = await DB.behaviors.get(pid);
      this._behaviors = behaviors || [];
      this._renderSkillChecks(this._behaviors);
      this._feedback('', false);
    } catch (err) {
      this._feedback('Could not load skills: ' + err.message, true);
    }
  }

  _feedback(msg, isError) {
    const fb = document.getElementById('report-feedback');
    if (!fb) return;
    fb.textContent = msg;
    fb.className = 'login-feedback ' + (isError ? 'error' : 'success');
  }

  // ── Generation ──────────────────────────────────────────────────────────

  async _generate() {
    if (this._generating) return;

    const pid = document.getElementById('report-participant').value;
    if (!pid) { this._feedback('Choose an athlete first.', true); return; }

    const participant = this._participants.find(p => String(p.id) === String(pid));
    const team = this._teams.find(t => String(t.id) === String(participant?.team_id));
    const skillIds = [...document.querySelectorAll('.report-skill-check:checked')].map(el => el.value);
    const domainIds = [...document.querySelectorAll('.report-domain-check:checked')].map(el => el.value);

    if (!skillIds.length) { this._feedback('Check at least one skill.', true); return; }
    if (!domainIds.length) { this._feedback('Check at least one domain.', true); return; }

    const skills = this._behaviors.filter(b => skillIds.includes(String(b.id)));
    const domains = this._domains.filter(d => domainIds.includes(String(d.id)));

    this._generating = true;
    const btn = document.getElementById('report-generate-btn');
    btn.disabled = true;

    try {
      const sections = [];
      const total = skills.length * domains.length;
      let done = 0;

      for (const skill of skills) {
        for (const domain of domains) {
          done++;
          this._feedback(`Rendering ${skill.name} — ${domain.name} (${done} of ${total})…`, false);
          const section = await this._renderSection(skill, domain);
          if (section) sections.push(section);
        }
      }

      if (!sections.length) {
        this._feedback('None of the selected skills have any data to include.', true);
        return;
      }

      this._feedback('Building PDF…', false);
      await this._buildPdf({
        athleteName: participant?.name || 'Athlete',
        teamName: team?.name || '',
        sections,
      });
      this._feedback('Report downloaded.', false);
    } catch (err) {
      this._feedback('Could not generate report: ' + err.message, true);
      console.error('[ExportReportModal]', err);
    } finally {
      this._generating = false;
      btn.disabled = false;
    }
  }

  async _renderSection(skill, domain) {
    const [rawPoints, meta] = await Promise.all([
      DB.points.get(skill.id, domain.id),
      DB.meta.get(skill.id, domain.id),
    ]);
    if (!rawPoints || !rawPoints.length) return null;

    const c = this.chart;
    c.points = rawPoints.map(p => ({
      id: p.id, type: p.type, day: p.day, val: p.val, note: p.note, floor: p.floor || null,
    }));
    c.meta = Object.assign({
      dotColor: '#009933', dotShape: 'circle',
      xColor:   '#cc0000', xShape:   'x',
      acceltarget: '', deceltarget: '', startDate: '',
    }, meta || {});
    const aimLo = meta?.aim_low  != null ? parseFloat(meta.aim_low)  : NaN;
    const aimHi = meta?.aim_high != null ? parseFloat(meta.aim_high) : NaN;
    c.aimLow  = isNaN(aimLo) ? null : aimLo;
    c.aimHigh = isNaN(aimHi) ? null : aimHi;
    c.chartType = 'daily';
    c.aggregation = 'geomean';
    c.overlays = [];
    c.showTrendlines = true;
    c.showPhaseLines = true;
    c.viewStart = 0;

    const maxDay = Math.max(...c.points.filter(p => !c._isLineType(p.type)).map(p => p.day), 0);
    c.draw();
    c.scrollToDay(maxDay);

    const canvas = document.getElementById('report-render-canvas');
    const imgData = canvas.toDataURL('image/png');
    const stats = c.getStats();

    return { skillName: skill.name, domainName: domain.name, imgData, stats, meta: c.meta };
  }

  // ── PDF assembly ────────────────────────────────────────────────────────

  // Reads the logo's raw bytes directly (fetch + FileReader) rather than
  // drawing it through a <canvas>, since canvas pixel-reads of local images
  // can be blocked under file:// — and if even that fails, the cover page
  // just skips the logo instead of the whole report failing.
  async _loadLogo() {
    if (this._logoDataUrl !== undefined) return this._logoDataUrl;
    try {
      const res = await fetch('img/logo.png');
      const blob = await res.blob();
      this._logoDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn('[ExportReportModal] logo could not be loaded, skipping it on the cover page', err);
      this._logoDataUrl = null;
    }
    return this._logoDataUrl;
  }

  _fmt(v) {
    return v >= 100 ? Math.round(v).toString() : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3);
  }

  _fmtCel(v) {
    if (!v) return '—';
    if (Math.abs(v - 1) < 0.005) return '× 1.00';
    return v > 1 ? `× ${this._fmt(v)}` : `÷ ${this._fmt(1 / v)}`;
  }

  _hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m ? m.slice(1).map(h => parseInt(h, 16)) : [40, 40, 40];
  }

  // Draws a marker as an actual vector shape (matching how SCCChart._drawPoints
  // draws it on the canvas) instead of a text glyph — jsPDF's built-in fonts
  // only support WinAnsi/Latin-1, so characters like ●/■/▲/◆ render as garbage.
  _drawMarkerShape(doc, cx, cy, shape, colorHex, s) {
    const [r, g, b] = this._hexToRgb(colorHex);
    doc.setFillColor(r, g, b);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.9);
    switch (shape) {
      case 'square':   doc.rect(cx - s, cy - s, s * 2, s * 2, 'F'); break;
      case 'triangle': doc.triangle(cx, cy - s, cx + s, cy + s, cx - s, cy + s, 'F'); break;
      case 'diamond':  doc.lines([[s, s], [-s, s], [-s, -s], [s, -s]], cx, cy - s, [1, 1], 'F', true); break;
      case 'plus':     doc.line(cx - s, cy, cx + s, cy); doc.line(cx, cy - s, cx, cy + s); break;
      case 'dash':     doc.line(cx - s, cy, cx + s, cy); break;
      case 'opencircle': doc.circle(cx, cy, s, 'S'); break;
      case 'x':        doc.line(cx - s, cy - s, cx + s, cy + s); doc.line(cx - s, cy + s, cx + s, cy - s); break;
      case 'circle':
      default:         doc.circle(cx, cy, s, 'F');
    }
  }

  // Draws the full Program Review box (goal, legend, marker key, current
  // condition, and the level/celeration/bounce/imp.index stats) into a
  // bordered box, mirroring the on-screen Program Review panel's key/value
  // styling (small bold blue-caps labels, bold dark values) — just laid out
  // to fit a narrow column next to Comments instead of the sidebar strip.
  _drawReviewBox(doc, x, y, w, h, section) {
    doc.setDrawColor(200, 220, 230);
    doc.rect(x, y, w, h);

    const pad = 10;
    const valueX = x + pad + 88;
    const valueW = w - pad - (valueX - x);
    let ty = y + pad + 7;

    const sectionHeader = text => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 153, 204);
      doc.text(text.toUpperCase(), x + pad, ty);
      doc.setDrawColor(208, 232, 240);
      doc.line(x + pad, ty + 3, x + w - pad, ty + 3);
      ty += 13;
    };
    const kv = (key, value) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(0, 153, 204);
      doc.text(key.toUpperCase(), x + pad, ty);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 51, 68);
      const lines = doc.splitTextToSize(String(value), valueW);
      lines.forEach((l, i) => doc.text(l, valueX, ty + i * 11));
      ty += 11 * Math.max(1, lines.length) + 2;
    };
    const markerRow = (shape, colorHex, label) => {
      this._drawMarkerShape(doc, x + pad + 4, ty - 3, shape, colorHex, 3.2);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(0, 51, 68);
      doc.text(label, x + pad + 14, ty);
      ty += 13;
    };
    const statRow = (key, value, shape, colorHex) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(0, 153, 204);
      doc.text(key, x + pad, ty);
      if (shape) this._drawMarkerShape(doc, valueX - 8, ty - 3, shape, colorHex, 3.2);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 51, 68);
      doc.text(String(value), valueX, ty);
      ty += 13;
    };

    const meta   = section.meta  || {};
    const stats  = section.stats || {};
    const dotColor = meta.dotColor || '#009933';
    const dotShape = meta.dotShape || 'circle';
    const xColor    = meta.xColor   || '#cc0000';
    const xShape    = meta.xShape   || 'x';

    sectionHeader('Program Overview');
    kv('Goal', meta.goal || '—');
    ty += 3;

    sectionHeader('Legend');
    kv('Displayed Points', 'Daily');
    kv('Celeration Method', 'Least Squares');
    kv('Bounce Method', 'Max Residual');
    kv('Level Method', 'Geometric Mean');
    ty += 3;
    markerRow(dotShape, dotColor, meta.correct   || 'correct responses');
    markerRow(xShape,   xColor,   meta.incorrect || 'incorrect responses');
    ty += 3;

    sectionHeader('Current Condition');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 51, 68);
    doc.text(stats.condition || 'N/A', x + pad, ty);
    ty += 15;

    statRow('LEVEL', stats.level != null ? this._fmt(stats.level) : '—', dotShape, dotColor);
    statRow('CELERATION', this._fmtCel(stats.dotCeleration), dotShape, dotColor);
    statRow('BOUNCE', stats.dotBounce != null ? '×' + this._fmt(stats.dotBounce) : '—', dotShape, dotColor);
    statRow('IMP. INDEX', this._fmtCel(stats.impIndex), null, null);
  }

  async _buildPdf(report) {
    if (!window.jspdf) {
      throw new Error('The PDF library failed to load (check your internet connection and try reloading the page).');
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const MARGIN = 40;
    const CHART_RATIO = 722 / 1010; // height / width
    const LOGO_RATIO  = 402 / 1015; // img/logo.png's actual height / width

    const logoDataUrl = await this._loadLogo();

    // ── Cover page ──────────────────────────────────────────────────────
    let y = 100;
    if (logoDataUrl) {
      const w = 180, h = w * LOGO_RATIO;
      doc.addImage(logoDataUrl, 'PNG', (PW - w) / 2, y, w, h);
      y += h + 40;
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0, 153, 204);
    doc.text('TEAM ABA', PW / 2, y, { align: 'center' }); y += 40;
    doc.setFontSize(28); doc.setTextColor(0, 51, 68);
    doc.text(report.athleteName, PW / 2, y, { align: 'center' }); y += 26;
    if (report.teamName) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(14); doc.setTextColor(90, 138, 154);
      doc.text(report.teamName, PW / 2, y, { align: 'center' }); y += 40;
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0, 51, 68);
    doc.text('Progress Report', PW / 2, y, { align: 'center' }); y += 22;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120, 120, 120);
    doc.text(new Date().toLocaleDateString(), PW / 2, y, { align: 'center' });

    // ── Table of contents — a plain ordered list, nothing else ───────────
    const tocLineH = 20;
    const tocStartY = MARGIN + 30;

    const countTocPages = n => {
      let pages = 1, y2 = tocStartY;
      for (let i = 0; i < n; i++) {
        if (y2 + tocLineH > PH - MARGIN) { pages++; y2 = MARGIN; }
        y2 += tocLineH;
      }
      return pages;
    };
    const tocPageCount = countTocPages(report.sections.length);
    const firstDetailPage = 1 /* cover */ + tocPageCount + 1;

    doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(0, 51, 68);
    doc.text('Table of Contents', MARGIN, MARGIN);
    let cy = tocStartY;

    report.sections.forEach((section, i) => {
      if (cy + tocLineH > PH - MARGIN) { doc.addPage(); cy = MARGIN; }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(0, 51, 68);
      doc.text(`${i + 1}. ${section.skillName} — ${section.domainName}`, MARGIN, cy);
      doc.setTextColor(90, 138, 154);
      doc.text(`Page ${firstDetailPage + i}`, PW - MARGIN, cy, { align: 'right' });
      cy += tocLineH;
    });

    // ── Detail pages ─────────────────────────────────────────────────────
    const detailImgW = PW - MARGIN * 2;
    const detailImgH = detailImgW * CHART_RATIO;

    report.sections.forEach(section => {
      doc.addPage();
      let dy = MARGIN;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0, 51, 68);
      doc.text(`${section.skillName} — ${section.domainName}`, MARGIN, dy);
      dy += 20;

      doc.addImage(section.imgData, 'PNG', MARGIN, dy, detailImgW, detailImgH);
      dy += detailImgH + 20;

      const bottomH   = PH - MARGIN - dy;
      const reviewW   = detailImgW * 0.38;
      const gap       = 16;
      const commentsW = detailImgW - reviewW - gap;

      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0, 51, 68);
      doc.text('Comments', MARGIN, dy);
      doc.setDrawColor(200, 220, 230);
      doc.rect(MARGIN, dy + 8, commentsW, bottomH - 8);

      this._drawReviewBox(doc, MARGIN + commentsW + gap, dy, reviewW, bottomH, section);
    });

    doc.save(`${report.athleteName} Progress Report.pdf`);
  }
}
