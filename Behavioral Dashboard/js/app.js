/**
 * app.js — entry point
 * Gates the dashboard behind authentication.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const appRoot = document.getElementById('app-root');

  // ── Hamburger sidebar toggle (mobile only) ────────────────────────────
  const hamburger = document.getElementById('btn-hamburger');
  const sidebar   = document.querySelector('.sidebar');
  const backdrop  = document.getElementById('sidebar-backdrop');
  function closeSidebar() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('visible');
  }
  hamburger.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('open');
    backdrop.classList.toggle('visible', isOpen);
  });
  backdrop.addEventListener('click', closeSidebar);
  document.querySelectorAll('.nav-item[data-domain]').forEach(el => {
    el.addEventListener('click', () => { if (window.innerWidth <= 640) closeSidebar(); });
  });

  function boot() {
    appRoot.style.display = '';
    window.dashboard = new Dashboard();
    _renderUserBadge();
  }

  function _renderUserBadge() {
    const profile = DB.auth.getProfile();
    const badge = document.getElementById('user-badge');
    if (!profile) { badge.innerHTML = ''; return; }
    badge.innerHTML = `
      <span>${profile.email}</span>
      <span class="role-tag">${profile.role}</span>
      ${DB.auth.isSupervisor() ? '<button id="btn-invite">Manage users</button>' : ''}
      <button id="btn-signout">Sign out</button>
    `;
    const inviteBtn = document.getElementById('btn-invite');
    if (inviteBtn) inviteBtn.addEventListener('click', () => window.inviteModal.show());
    document.getElementById('btn-signout').addEventListener('click', async () => {
      await DB.auth.signOut();
      location.reload();
    });
  }

  window.loginScreen = new LoginScreen(boot);
  window.inviteModal = new InviteModal();

  // Try to restore a previous session before showing the login screen
  const restored = await DB.auth.restoreSession();
  if (restored) {
    boot();
  } else {
    window.loginScreen.show();
  }
});
