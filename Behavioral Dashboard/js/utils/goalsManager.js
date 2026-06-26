class GoalsManager {
  constructor() {
    this._behaviorId  = null;
    this._domainId    = null;
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
  }

  // Called by Dashboard when a domain item is selected in the tree
  async setDomain(behaviorId, domainId, title, participantId, participantName, teamName) {
    this._behaviorId       = behaviorId;
    this._domainId         = domainId;
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
    if (!this._behaviorId || !this._domainId) return;
    try {
      this._goals = (await DB.goals.get(this._behaviorId, this._domainId)) || [];
      this._render();
    } catch (err) {
      console.error('[Goals] Load failed:', err);
    }
  }

  async _addGoal() {
    const type   = this._typeEl.value;
    const target = parseFloat(this._valueEl.value);
    const note   = this._noteEl?.value.trim() || '';
    if (isNaN(target) || target <= 0) {
      this._showFeedback('Enter a target value greater than 0.', 'error');
      return;
    }
    this._addBtn.disabled = true;
    try {
      const goal = await DB.goals.add(this._behaviorId, this._domainId, { type, target, note });
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
    if (!this._goals.length || !this._behaviorId) return;
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
      await DB.functions.invoke('send-goal-email', {
        to_emails:        toEmails,
        participant_name: this._participantName || '',
        team_name:        this._teamName        || '',
        domain:           this._domainTitle     || '',
        goal_desc:        goalDesc,
        actual_value:     actual,
        goal_note:        noteText
      });
    } catch (err) {
      this._showNoticeError('Goal met but email failed to send: ' + err.message);
    }
  }

  _typeLabel(type) {
    return { acceleration: 'Acceleration', deceleration: 'Deceleration', count_per_min: 'Rate', bounce: 'Bounce' }[type] || type;
  }

  _targetDisplay(goal) {
    switch (goal.type) {
      case 'acceleration':  return `≥ ${goal.target}×/wk`;
      case 'deceleration':  return `÷${goal.target}/wk`;
      case 'count_per_min': return `≥ ${goal.target} /min`;
      case 'bounce':        return `≤ ${goal.target}`;
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
