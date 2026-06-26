// Thresholds — lower values for testing; revert to production values before merging to main.
const INACTIVITY_WARN_MS  = 55 * 60 * 1000;  // 55 min: show warning modal
const INACTIVITY_LIMIT_MS =  5 * 60 * 1000;  //  5 min: countdown, then log out

class InactivityMonitor {
  constructor(onLogout) {
    this._onLogout    = onLogout;
    this._overlay     = document.getElementById('inactivity-overlay');
    this._countdownEl = document.getElementById('inactivity-countdown');
    this._warnTimer   = null;
    this._ticker      = null;
    this._remaining   = 0;

    // Stored as a property so destroy() can pass the same reference to removeEventListener.
    this._handleActivity = () => this._reset();
    document.addEventListener('click', this._handleActivity, true);
    this._reset();
  }

  _reset() {
    clearTimeout(this._warnTimer);
    this._stopTicker();
    this._overlay.classList.add('hidden');
    this._warnTimer = setTimeout(() => this._warn(), INACTIVITY_WARN_MS);
  }

  _warn() {
    this._remaining = INACTIVITY_LIMIT_MS;
    this._overlay.classList.remove('hidden');
    this._tick();
    this._ticker = setInterval(() => this._tick(), 1000);
  }

  _tick() {
    this._countdownEl.textContent = this._fmt(this._remaining);
    this._remaining -= 1000;
    if (this._remaining < 0) {
      this._stopTicker();
      this._onLogout();
    }
  }

  _stopTicker() {
    clearInterval(this._ticker);
    this._ticker = null;
  }

  _fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  triggerWarning(overrideMs) {
    this._remaining = overrideMs != null ? overrideMs : INACTIVITY_LIMIT_MS;
    this._overlay.classList.remove('hidden');
    this._tick();
    this._ticker = setInterval(() => this._tick(), 1000);
  }

  destroy() {
    clearTimeout(this._warnTimer);
    this._stopTicker();
    document.removeEventListener('click', this._handleActivity, true);
  }
}
