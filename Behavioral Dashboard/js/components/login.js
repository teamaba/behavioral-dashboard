/**
 * login.js — Login / signup / password reset overlay
 * Depends on DB.auth (db.js). Calls onLoginSuccess() once authenticated.
 */

class LoginScreen {
  constructor(onLoginSuccess) {
    this.onLoginSuccess = onLoginSuccess;
    this.mode = 'signin'; // 'signin' | 'signup' | 'reset'
    this.overlay = document.getElementById('login-overlay');
    this._render();
  }

  show() { this.overlay.classList.remove('hidden'); }
  hide() { this.overlay.classList.add('hidden'); }

  _render() {
    const titles = {
      signin: 'Sign in',
      signup: 'First time? Set your password',
      reset:  'Reset your password'
    };

    this.overlay.innerHTML = `
      <div class="login-card">
        <img src="img/logo.png" alt="Team ABA" class="login-logo-img">
        <div class="login-mode-label">${titles[this.mode]}</div>

        <div class="login-field">
          <label for="login-email">Email</label>
          <input type="email" id="login-email" placeholder="you@teamaballc.com" autocomplete="username">
        </div>

        ${this.mode !== 'reset' ? `
        <div class="login-field">
          <label for="login-password">${this.mode === 'signup' ? 'Choose a password' : 'Password'}</label>
          <input type="password" id="login-password" placeholder="••••••••" autocomplete="${this.mode === 'signup' ? 'new-password' : 'current-password'}">
        </div>` : ''}

        <button class="login-btn" id="login-submit">
          ${this.mode === 'signin' ? 'Sign in' : this.mode === 'signup' ? 'Set password & sign in' : 'Send reset email'}
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

    const signupLink = document.getElementById('link-signup');
    const signinLink = document.getElementById('link-signin');
    const resetLink  = document.getElementById('link-reset');
    if (signupLink) signupLink.addEventListener('click', () => { this.mode = 'signup'; this._render(); });
    if (signinLink) signinLink.addEventListener('click', () => { this.mode = 'signin'; this._render(); });
    if (resetLink)  resetLink.addEventListener('click',  () => { this.mode = 'reset';  this._render(); });
  }

  async _submit() {
    const email = document.getElementById('login-email').value.trim();
    const fb = document.getElementById('login-feedback');
    fb.textContent = ''; fb.className = 'login-feedback';

    if (!email) { this._feedback('Enter your email.', true); return; }

    const btn = document.getElementById('login-submit');
    btn.disabled = true;

    try {
      if (this.mode === 'reset') {
        await DB.auth.requestPasswordReset(email);
        this._feedback('Check your email for a reset link.', false);

      } else {
        const password = document.getElementById('login-password').value;
        if (!password || password.length < 6) {
          this._feedback('Password must be at least 6 characters.', true);
          btn.disabled = false;
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
    fb.textContent = msg;
    fb.className = 'login-feedback ' + (isError ? 'error' : 'success');
  }
}
