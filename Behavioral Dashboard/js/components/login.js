/**
 * login.js — Login / signup / password reset overlay
 * Depends on DB.auth (db.js). Calls onLoginSuccess() once authenticated.
 */

class LoginScreen {
  constructor(onLoginSuccess) {
    this.onLoginSuccess = onLoginSuccess;
    this.mode = 'signin'; // 'signin' | 'signup' | 'reset' | 'new-password'
    this._recoveryToken = null;
    this.overlay = document.getElementById('login-overlay');
    this._render();
  }

  show() { this.overlay.classList.remove('hidden'); }
  hide() { this.overlay.classList.add('hidden'); }

  showPasswordReset(token) {
    this._recoveryToken = token;
    this.mode = 'new-password';
    this._render();
    this.show();
  }

  _render() {
    const titles = {
      signin:        'Sign in',
      signup:        'First time? Set your password',
      reset:         'Reset your password',
      'new-password': 'Set a new password'
    };

    const passwordField = (id, label, autocomplete) => `
      <div class="login-field">
        <label for="${id}">${label}</label>
        <div class="password-wrap">
          <input type="password" id="${id}" placeholder="••••••••" autocomplete="${autocomplete}">
          <button type="button" class="password-toggle" data-target="${id}" aria-label="Show password"></button>
        </div>
      </div>`;

    this.overlay.innerHTML = `
      <div class="login-card">
        <img src="img/logo.png" alt="Team ABA" class="login-logo-img">
        <div class="login-mode-label">${titles[this.mode]}</div>

        ${this.mode !== 'new-password' ? `
        <div class="login-field">
          <label for="login-email">Email</label>
          <input type="email" id="login-email" placeholder="you@teamaballc.com" autocomplete="username">
        </div>` : ''}

        ${this.mode === 'signin'  ? passwordField('login-password', 'Password', 'current-password') : ''}
        ${this.mode === 'signup'  ? passwordField('login-password', 'Choose a password', 'new-password') : ''}
        ${this.mode === 'new-password' ? passwordField('login-password', 'New password', 'new-password') : ''}

        <button class="login-btn" id="login-submit">
          ${{ signin: 'Sign in', signup: 'Set password & sign in', reset: 'Send reset email', 'new-password': 'Update password' }[this.mode]}
        </button>

        <div class="login-links">
          ${this.mode !== 'signin' ? '<a id="link-signin">Back to sign in</a>' : '<a id="link-signup">First time here?</a>'}
          ${this.mode === 'signin' ? '<a id="link-reset">Forgot password?</a>' : ''}
        </div>

        <div class="login-feedback" id="login-feedback"></div>
      </div>
    `;

    document.getElementById('login-submit').addEventListener('click', () => this._submit());
    this.overlay.querySelectorAll('input').forEach(input => {
      input.addEventListener('keydown', e => { if (e.key === 'Enter') this._submit(); });
    });

    const EYE_OPEN   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const EYE_CLOSED = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

    this.overlay.querySelectorAll('.password-toggle').forEach(btn => {
      btn.innerHTML = EYE_OPEN;
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.innerHTML = showing ? EYE_OPEN : EYE_CLOSED;
        btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      });
    });

    const signupLink = document.getElementById('link-signup');
    const signinLink = document.getElementById('link-signin');
    const resetLink  = document.getElementById('link-reset');
    if (signupLink) signupLink.addEventListener('click', () => { this.mode = 'signup'; this._render(); });
    if (signinLink) signinLink.addEventListener('click', () => { this._recoveryToken = null; this.mode = 'signin'; this._render(); });
    if (resetLink)  resetLink.addEventListener('click',  () => { this.mode = 'reset';  this._render(); });
  }

  async _submit() {
    const fb = document.getElementById('login-feedback');
    fb.textContent = ''; fb.className = 'login-feedback';

    const btn = document.getElementById('login-submit');
    btn.disabled = true;

    try {
      if (this.mode === 'reset') {
        const email = document.getElementById('login-email').value.trim();
        if (!email) { this._feedback('Enter your email.', true); return; }
        await DB.auth.requestPasswordReset(email);
        this._feedback('Check your email for a reset link.', false);

      } else if (this.mode === 'new-password') {
        const password = document.getElementById('login-password').value;
        if (!password || password.length < 6) {
          this._feedback('Password must be at least 6 characters.', true);
          return;
        }
        await DB.auth.updatePassword(this._recoveryToken, password);
        this._recoveryToken = null;
        this.mode = 'signin';
        this._render();
        this._feedback('Password updated! You can now sign in.', false);

      } else {
        const email = document.getElementById('login-email').value.trim();
        if (!email) { this._feedback('Enter your email.', true); return; }
        const password = document.getElementById('login-password').value;
        if (!password || password.length < 6) {
          this._feedback('Password must be at least 6 characters.', true);
          return;
        }

        if (this.mode === 'signup') {
          await DB.auth.signUp(email, password);
        } else {
          await DB.auth.signIn(email, password);
        }

        this.hide();
        this.onLoginSuccess();
      }
    } catch (err) {
      this._feedback(this._friendlyError(err.message), true);
    } finally {
      btn.disabled = false;
    }
  }

  _friendlyError(msg) {
    if (/not authorized/i.test(msg)) return 'This email is not on the approved list. Contact your supervisor.';
    if (/invalid login/i.test(msg))  return 'Incorrect email or password.';
    if (/already registered/i.test(msg)) return 'An account already exists for this email — try signing in instead.';
    return msg;
  }

  _feedback(msg, isError) {
    const fb = document.getElementById('login-feedback');
    if (!fb) return;
    fb.textContent = msg;
    fb.className = 'login-feedback ' + (isError ? 'error' : 'success');
  }
}
