/**
 * app.js — entry point
 * Gates the dashboard behind authentication.
 * Flow: login → hierarchy home page → chart view (← back → hierarchy)
 */

document.addEventListener('DOMContentLoaded', async () => {
  const appRoot = document.getElementById('app-root');

  // Capture reason before clearing — used to show a notice on the login screen.
  const logoutReason = sessionStorage.getItem('logout_reason');
  if (logoutReason) sessionStorage.removeItem('logout_reason');

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

  // ── Two-view navigation ───────────────────────────────────────────────
  function showHierarchy() {
    appRoot.style.display = 'none';
    window.hierarchyView.show();
    closeSidebar();
  }

  function showChart(behaviorId, domainSlug, context) {
    window.hierarchyView.hide();
    appRoot.style.display = '';
    window.dashboard.activate(behaviorId, domainSlug, context);
  }

  document.getElementById('btn-overview')
    .addEventListener('click', showHierarchy);

  // ── Boot (called after successful auth) ──────────────────────────────
  function boot() {
    if (DB.auth.isClient()) document.body.classList.add('client-view');
    window.dashboard = new Dashboard();
    window.hierarchyView = new HierarchyView(showChart);
    _renderUserBadge();
    window.inactivityMonitor = new InactivityMonitor(async () => {
      await DB.auth.signOut();
      sessionStorage.setItem('logout_reason', 'inactivity');
      location.reload();
    });
    if (DB.auth.isClient()) {
      // Clients skip the hierarchy view — the sidebar NavTree is their navigation
      appRoot.style.display = '';
      window.navTree = new NavTree(showChart);
    } else {
      showHierarchy();
    }
  }

  function _renderUserBadge() {
    const profile = DB.auth.getProfile();

    // Badge in the chart topbar
    const badge = document.getElementById('user-badge');
    if (badge) {
      if (profile) {
        badge.innerHTML = `
          <span class="topbar-user-email">${profile.email}</span>
          <span class="role-tag">${profile.role}</span>
          ${DB.auth.isSupervisor() ? '<button class="btn-outline topbar-action-btn" id="btn-invite">Manage users</button>' : ''}
          <button class="btn-outline topbar-action-btn" id="btn-signout">Sign out</button>
        `;
        const inviteBtn = document.getElementById('btn-invite');
        if (inviteBtn) inviteBtn.addEventListener('click', () => window.inviteModal.show());
        document.getElementById('btn-signout').addEventListener('click', async () => {
          await DB.auth.signOut();
          location.reload();
        });
      } else {
        badge.innerHTML = '';
      }
    }

    // Badge in the hierarchy view topbar
    const hvBadge = document.getElementById('hv-user-badge');
    if (hvBadge && profile) {
      hvBadge.innerHTML = `
        <span class="hv-user-email">${profile.email}</span>
        <span class="role-tag">${profile.role}</span>
        ${DB.auth.isSupervisor() ? '<button class="hv-manage-btn" id="hv-btn-invite">Manage users</button>' : ''}
        <button class="hv-signout-btn" id="hv-btn-signout">Sign out</button>
      `;
      document.getElementById('hv-btn-signout').addEventListener('click', async () => {
        await DB.auth.signOut();
        location.reload();
      });
      const hvInvite = document.getElementById('hv-btn-invite');
      if (hvInvite) hvInvite.addEventListener('click', () => window.inviteModal.show());
    }
  }

  window.loginScreen = new LoginScreen(boot);
  window.inviteModal = new InviteModal();

  // Try to restore a previous session before showing the login screen
  const restored = await DB.auth.restoreSession();
  if (restored) {
    boot();
  } else {
    window.loginScreen.show();
    if (logoutReason === 'inactivity') {
      const card = document.querySelector('#login-overlay .login-card');
      if (card) {
        const msg = document.createElement('p');
        msg.className = 'login-inactivity-msg';
        msg.textContent = 'You were logged out due to inactivity.';
        card.prepend(msg);
      }
    }
  }
});
