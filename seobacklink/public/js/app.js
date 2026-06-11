// Shared utilities
const $ = id => document.getElementById(id);
const show = el => { if (el) el.style.display = 'block'; };
const hide = el => { if (el) el.style.display = 'none'; };

function showAlert(el, msg, type = 'error') {
  if (!el) return;
  el.textContent = msg;
  el.className = `alert alert-${type}`;
  show(el);
  if (type === 'success') setTimeout(() => hide(el), 4000);
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  return data;
}

// Redirect if not authenticated (for app pages)
async function requireAuth() {
  try {
    const user = await api('GET', '/api/auth/me');
    return user;
  } catch {
    window.location.href = '/login';
    return null;
  }
}

// Populate sidebar user info
function setSidebarUser(user) {
  const nameEl = document.querySelector('.sidebar-user-name');
  const planEl = document.querySelector('.sidebar-user-plan');
  if (nameEl) nameEl.textContent = user.name;
  if (planEl) planEl.textContent = user.plan_type.charAt(0).toUpperCase() + user.plan_type.slice(1) + ' Plan';
}

// Mark active sidebar link
function setActiveNav() {
  const path = window.location.pathname;
  document.querySelectorAll('.sidebar a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === path);
  });
}

// Logout
document.querySelectorAll('[data-logout]').forEach(btn => {
  btn.addEventListener('click', async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    window.location.href = '/';
  });
});

// FAQ accordion
document.querySelectorAll('.faq-q').forEach(q => {
  q.addEventListener('click', () => {
    const item = q.closest('.faq-item');
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  });
});

// Format date
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format number
function fmtNum(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

// Status badge
function statusBadge(status) {
  const map = {
    ready: 'badge-green', generating: 'badge-yellow', failed: 'badge-red',
    active: 'badge-green', pending: 'badge-yellow', lost: 'badge-red', rejected: 'badge-gray',
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status}</span>`;
}
