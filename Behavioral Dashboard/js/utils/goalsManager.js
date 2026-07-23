class GoalsManager {
  constructor() {
    this._instanceId  = null;
    this._domainTitle = null;
    this._goals       = [];

    this._section  = document.getElementById('goals-section');
    this._list     = document.getElementById('goals-list');
    this._feedback = document.getElementById('goals-feedback');
    this._typeEl   = document.getElementById('goal-type');
    this._valueEl  = document.getElementById('goal-value');
    this._noteEl   = document.getElementById('goal-note');
    this._addBtn   = document.getElementById('btn-add-goal');
    this._notice   = document.getElementById('goals-achieved-notice');

    this._section.classList.remove('hidden');
    this._bindEvents();
    this._updateValueInputMode();
  }

  // Duration/latency targets are entered as a time (m:ss) rather than a raw number.
  _isTimeType(type) { return type === 'duration' || type === 'latency'; }

  _updateValueInputMode() {
    if (this._isTimeType(this._typeEl.value)) {
      this._valueEl.type = 'text';
      this._valueEl.placeholder = 'e.g. 0:30, 0:00.8, or 1:00:00';
    } else {
      this._valueEl.type = 'number';
      this._valueEl.placeholder = 'e.g. 1.25';
    }
  }

  // Accepts h:mm:ss, m:ss, or plain seconds — the last (seconds) segment may carry
  // a decimal (e.g. 0:00.8) for sub-second latency precision; hours/minutes stay whole.
  _parseTime(str) {
    if (!str) return null;
    const segs = str.split(':');
    if (segs.length < 1 || segs.length > 3) return null;
    const nums = segs.map((s, i) => i === segs.length - 1 ? parseFloat(s) : parseInt(s, 10));
    if (nums.some(isNaN)) return null;
    if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
    if (nums.length === 2) return nums[0] * 60 + nums[1];
    return nums[0];
  }

  _formatTime(sec) {
    if (!sec) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const sStr = this._formatSecPart(s);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${sStr}`;
    return `${m}:${sStr}`;
  }

  // Whole seconds pad to 2 digits as before ("05"); a fractional remainder is
  // appended and trailing zeros are trimmed ("05.8").
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

  // Duration/latency goals are tracked via the existing rate-chart machinery: staff log
  // 1 success with the floor set to the held/response time, giving val = 60/seconds.
  // These two conversions are the ONLY place that trick lives — if we later back this
  // with real duration/latency data instead, only these (plus the two cases below that
  // call them) need to change.
  _secondsToRate(sec) { return sec > 0 ? 60 / sec : null; }
  _rateToSeconds(rate) { return rate ? 60 / rate : null; }

  // Called by Dashboard when a pinpoint chart instance is selected in the tree
  async setInstance(instanceId, title, participantId, participantName, teamName) {
    this._instanceId       = instanceId;
    this._domainTitle      = title;
    this._participantId    = participantId    || null;
    this._participantName  = participantName  || null;
    this._teamName         = teamName         || null;
    this._goals = [];
    if (this._notice) this._notice.classList.add('hidden');
    this._render();
    await this._load();
  }

  _bindEvents() {
    this._typeEl.addEventListener('change', () => this._updateValueInputMode());
    this._addBtn.addEventListener('click', () => this._addGoal());
    this._valueEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._addGoal();
    });
    this._noteEl?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._addGoal();
    });
    this._list.addEventListener('click', e => {
      const btn = e.target.closest('.goal-delete-btn');
      if (btn) this._deleteGoal(btn.dataset.id);
    });
  }

  async _load() {
    if (!this._instanceId) return;
    try {
      this._goals = (await DB.goals.get(this._instanceId)) || [];
      this._render();
    } catch (err) {
      console.error('[Goals] Load failed:', err);
    }
  }

  async _addGoal() {
    const type   = this._typeEl.value;
    const isTime = this._isTimeType(type);
    const target = isTime ? this._parseTime(this._valueEl.value.trim()) : parseFloat(this._valueEl.value);
    const note   = this._noteEl?.value.trim() || '';
    if (!target || isNaN(target) || target <= 0) {
      this._showFeedback(isTime ? 'Enter a target time greater than 0 (e.g. 0:30 or 0:00.8).' : 'Enter a target value greater than 0.', 'error');
      return;
    }
    this._addBtn.disabled = true;
    try {
      const goal = await DB.goals.add(this._instanceId, { type, target, note });
      this._goals.push(goal);
      this._valueEl.value = '';
      if (this._noteEl) this._noteEl.value = '';
      this._render();
      this._showFeedback('Goal added.', 'success');
    } catch (err) {
      this._showFeedback('Could not save goal.', 'error');
      console.error('[Goals] Add failed:', err);
    } finally {
      this._addBtn.disabled = false;
    }
  }

  async _deleteGoal(id) {
    try {
      await DB.goals.delete(id);
      this._goals = this._goals.filter(g => g.id !== id);
      this._render();
    } catch (err) {
      this._showFeedback('Could not delete goal.', 'error');
      console.error('[Goals] Delete failed:', err);
    }
  }

  _render() {
    if (!this._goals.length) {
      this._list.innerHTML = '<p class="goals-empty">No goals set.</p>';
      return;
    }
    this._list.innerHTML = this._goals.map(g => `
      <div class="goal-row">
        <div class="goal-info">
          <span class="goal-type-tag goal-type-tag--${g.type}">${this._typeLabel(g.type)}</span>
          <span class="goal-target">${this._targetDisplay(g)}</span>
          ${g.note ? `<span class="goal-note">${g.note}</span>` : ''}
        </div>
        <button class="goal-delete-btn" data-id="${g.id}" title="Remove goal">✕</button>
      </div>
    `).join('');
  }

  // Called by Dashboard after every successful data entry save
  async checkGoals(chart) {
    if (!this._goals.length || !this._instanceId) return;
    const stats = chart.getStats();
    const met   = this._goals.filter(g => this._goalMet(g, stats));
    if (!met.length) return;

    for (const goal of met) {
      this._goals = this._goals.filter(g => g.id !== goal.id);
      try { await DB.goals.markAchieved(goal.id); } catch (e) { console.error(e); }
      await this._notify(goal, stats);
    }
    this._render();
  }

  _goalMet(goal, stats) {
    if (!stats) return false;
    switch (goal.type) {
      case 'acceleration':
        // Celeration reaches or exceeds target (e.g. ≥ 1.25×/wk)
        return stats.dotCeleration != null && stats.dotCeleration >= goal.target;
      case 'deceleration':
        // Target expressed as ÷X/wk; threshold in celeration terms = 1/X
        return stats.dotCeleration != null && stats.dotCeleration <= (1 / goal.target);
      case 'count_per_min':
        return stats.level != null && stats.level >= goal.target;
      case 'bounce':
        return stats.dotBounce != null && stats.dotBounce <= goal.target;
      case 'duration':
        // Checked against the single latest entry (not the rolling average like other
        // goal types) — one qualifying hold is enough. Held time >= target seconds
        // <=> rate (60/sec) <= 60/target
        return stats.latestDotVal != null && stats.latestDotVal <= this._secondsToRate(goal.target);
      case 'latency':
        // Same single-entry logic as duration. Response time <= target seconds
        // <=> rate (60/sec) >= 60/target
        return stats.latestDotVal != null && stats.latestDotVal >= this._secondsToRate(goal.target);
      default:
        return false;
    }
  }

  async _notify(goal, stats) {
    const goalDesc = `${this._typeLabel(goal.type)}: ${this._targetDisplay(goal)}`;
    const actual   = this._actualDisplay(goal, stats);
    const noteText = goal.note || '';

    if (this._notice) {
      this._notice.textContent = `Goal met: ${goalDesc} (current: ${actual})${noteText ? ' — ' + noteText : ''}`;
      this._notice.classList.remove('hidden');
    }

    if (!this._participantId) return;
    let toEmails = [];
    try {
      const rows = await DB.notifications.getForParticipant(this._participantId);
      toEmails = (rows || []).map(r => r.email).filter(Boolean);
    } catch (err) {
      this._showNoticeError('Goal met but could not load notification list: ' + err.message);
      return;
    }
    if (!toEmails.length) return;

    try {
      const result = await DB.functions.invoke('send-goal-email', {
        to_emails:        toEmails,
        participant_name: this._participantName || '',
        team_name:        this._teamName        || '',
        domain:           this._domainTitle     || '',
        goal_desc:        goalDesc,
        actual_value:     actual,
        goal_note:        noteText
      });
      if (result?.rejected?.length) {
        this._showNoticeError('Email rejected for: ' + result.rejected.join(', '));
      }
    } catch (err) {
      this._showNoticeError('Goal met but email failed to send: ' + err.message);
    }
  }

  _typeLabel(type) {
    return { acceleration: 'Acceleration', deceleration: 'Deceleration', count_per_min: 'Rate', bounce: 'Bounce', duration: 'Duration', latency: 'Latency' }[type] || type;
  }

  _targetDisplay(goal) {
    switch (goal.type) {
      case 'acceleration':  return `≥ ${goal.target}×/wk`;
      case 'deceleration':  return `÷${goal.target}/wk`;
      case 'count_per_min': return `≥ ${goal.target} /min`;
      case 'bounce':        return `≤ ${goal.target}`;
      case 'duration':      return `≥ ${this._formatTime(goal.target)}`;
      case 'latency':       return `≤ ${this._formatTime(goal.target)}`;
      default:              return `${goal.target}`;
    }
  }

  _actualDisplay(goal, stats) {
    const fmt = v => v != null ? parseFloat(v.toFixed(2)).toString() : '—';
    switch (goal.type) {
      case 'acceleration':
      case 'deceleration':  return stats.dotCeleration ? `${fmt(stats.dotCeleration)}×/wk` : '—';
      case 'count_per_min': return stats.level          ? `${fmt(stats.level)} /min`             : '—';
      case 'bounce':        return stats.dotBounce       ? fmt(stats.dotBounce)                   : '—';
      case 'duration':
      case 'latency': {
        const sec = this._rateToSeconds(stats.latestDotVal);
        return sec != null ? this._formatTime(sec) : '—';
      }
      default:              return '—';
    }
  }

  _showNoticeError(msg) {
    if (!this._notice) return;
    this._notice.textContent = this._notice.textContent + ' — ⚠ ' + msg;
    this._notice.classList.remove('hidden');
  }

  _showFeedback(msg, cls) {
    this._feedback.textContent = msg;
    this._feedback.className   = `goals-feedback goals-feedback--${cls}`;
    this._feedback.classList.remove('hidden');
    setTimeout(() => this._feedback.classList.add('hidden'), 3000);
  }
}
