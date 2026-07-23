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

  function showChart(instanceId, context) {
    window.hierarchyView.hide();
    appRoot.style.display = '';
    window.dashboard.activate(instanceId, context);
  }
  window.showHierarchyView = showHierarchy; // exposed so OverlayView's "Back" button can return here
  window.showChart = showChart; // exposed so AddChartModal can jump straight into a newly created chart

  document.getElementById('btn-overview')
    .addEventListener('click', showHierarchy);

  // ── Boot (called after successful auth) ──────────────────────────────
  function boot() {
    if (DB.auth.isClient() || DB.auth.isGuide()) document.body.classList.add('client-view');
    // Only real clients get the flat sidebar nav instead of the Overview page —
    // Guides need "← Overview" to get back to their staff-style hierarchy view.
    if (DB.auth.isClient()) document.body.classList.add('client-only-view');
    window.dashboard = new Dashboard();
    window.hierarchyView = new HierarchyView(showChart);
    window.overlayView = new OverlayView();
    window.overlayModal = new OverlayModal(window.dashboard, window.overlayView);
    window.exportReportModal = new ExportReportModal();
    if (DB.auth.isStaff()) {
      window.pinpointsLibrary  = new PinpointsLibrary();
      window.pinpointFormModal = new PinpointFormModal();
      window.addChartModal     = new AddChartModal();
    }
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

    // Badge in the chart topbar — same button styling/set as the hierarchy topbar
    const badge = document.getElementById('user-badge');
    if (badge) {
      if (profile) {
        badge.innerHTML = `
          <span class="topbar-user-email">${profile.email}</span>
          <span class="role-tag">${profile.role}</span>
          ${DB.auth.isStaff() ? '<button class="hv-manage-btn" id="btn-pinpoints">Pinpoints Library</button>' : ''}
          ${DB.auth.isStaff() ? '<button class="hv-manage-btn" id="btn-overlay">Overlay Charts</button>' : ''}
          ${DB.auth.isStaff() ? '<button class="hv-manage-btn" id="btn-report">Export Report</button>' : ''}
          <button class="hv-manage-btn" id="btn-export-image">Export Image</button>
          ${DB.auth.isSupervisor() ? '<button class="hv-manage-btn" id="btn-invite">Manage users</button>' : ''}
          <button class="hv-signout-btn" id="btn-signout">Sign out</button>
        `;
        const inviteBtn = document.getElementById('btn-invite');
        if (inviteBtn) inviteBtn.addEventListener('click', () => window.inviteModal.show());
        const pinpointsBtn = document.getElementById('btn-pinpoints');
        if (pinpointsBtn) pinpointsBtn.addEventListener('click', () => window.pinpointsLibrary.show());
        const overlayBtn = document.getElementById('btn-overlay');
        if (overlayBtn) overlayBtn.addEventListener('click', () => window.overlayModal.show());
        const reportBtn = document.getElementById('btn-report');
        if (reportBtn) reportBtn.addEventListener('click', () => window.exportReportModal.show());
        const exportImageBtn = document.getElementById('btn-export-image');
        if (exportImageBtn) exportImageBtn.addEventListener('click', () => window.dashboard._exportChartImage());
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
        ${DB.auth.isStaff() ? '<button class="hv-manage-btn" id="hv-btn-pinpoints">Pinpoints Library</button>' : ''}
        ${DB.auth.isStaff() ? '<button class="hv-manage-btn" id="hv-btn-overlay">Overlay Charts</button>' : ''}
        ${DB.auth.isStaff() ? '<button class="hv-manage-btn" id="hv-btn-report">Export Report</button>' : ''}
        ${DB.auth.isSupervisor() ? '<button class="hv-manage-btn" id="hv-btn-invite">Manage users</button>' : ''}
        <button class="hv-signout-btn" id="hv-btn-signout">Sign out</button>
      `;
      document.getElementById('hv-btn-signout').addEventListener('click', async () => {
        await DB.auth.signOut();
        location.reload();
      });
      const hvInvite = document.getElementById('hv-btn-invite');
      if (hvInvite) hvInvite.addEventListener('click', () => window.inviteModal.show());
      const hvPinpoints = document.getElementById('hv-btn-pinpoints');
      if (hvPinpoints) hvPinpoints.addEventListener('click', () => window.pinpointsLibrary.show());
      const hvOverlay = document.getElementById('hv-btn-overlay');
      if (hvOverlay) hvOverlay.addEventListener('click', () => window.overlayModal.show());
      const hvReport = document.getElementById('hv-btn-report');
      if (hvReport) hvReport.addEventListener('click', () => window.exportReportModal.show());
    }
  }

  window.loginScreen = new LoginScreen(boot);
  window.inviteModal = new InviteModal();

  // Detect password-reset link — Supabase may use hash fragment or query params
  const _hash  = new URLSearchParams(window.location.hash.slice(1));
  const _query = new URLSearchParams(window.location.search);
  const _type  = _hash.get('type')         || _query.get('type');
  const _token = _hash.get('access_token') || _query.get('access_token');

  if (_type === 'recovery' && _token) {
    window.history.replaceState(null, '', window.location.pathname);
    window.loginScreen.showPasswordReset(_token);
  } else {
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
  }
});
