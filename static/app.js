/**
 * POST /api/expenses
 *
 * Request body (JSON):
 * {
 *   "description": "Dinner at Rosini",
 *   "amount":      64.00,
 *   "paid_by":     "Emma",        // "Emma" | "Ferdinand"
 *   "category":    "🍽️",
 *   "date":        "2024-04-22"   // ISO date string
 * }
 *
 * Expected response (JSON):
 * {
 *   "id":          "abc123",
 *   "description": "Dinner at Rosini",
 *   "amount":      64.00,
 *   "paid_by":     "Emma",
 *   "category":    "🍽️",
 *   "date":        "2024-04-22"
 * }
 */
const API_ENDPOINT = '/api/expenses';

// activeUser is injected by the server into a <meta> tag.
// Falls back to null on the shared /  view.
const metaUser = document.querySelector('meta[name="active-user"]');
const ACTIVE_USER = metaUser ? metaUser.content : null;  // "Emma" | "Ferdinand" | null
const OTHER_USER  = ACTIVE_USER === 'Emma' ? 'Ferdinand'
                  : ACTIVE_USER === 'Ferdinand' ? 'Emma'
                  : null;

let expenses  = [];
let isOffline = false;

// ── Boot: personalise the UI ──────────────────────────────────────────────────

function personalise() {
  if (!ACTIVE_USER) {
    document.getElementById('add-expense-section').style.display = 'none';
    return;
  }

  document.title = `${ACTIVE_USER}'s expenses`;
  document.getElementById('page-title').textContent    = `Hi, ${ACTIVE_USER}`;
  document.getElementById('page-subtitle').textContent = `Shared with ${OTHER_USER}`;
  document.getElementById('label-me').textContent      = 'You paid';
  document.getElementById('label-other').textContent   = `${OTHER_USER} paid`;

  // Highlight the active user's avatar
  const meEl    = ACTIVE_USER === 'Emma'
    ? document.getElementById('avatar-e')
    : document.getElementById('avatar-f');
  meEl.style.outline = '2px solid currentColor';
  meEl.style.outlineOffset = '2px';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) { return '€' + n.toFixed(2); }

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

function setStatus(msg, type) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className   = 'status-msg ' + (type || '');
}

function setOffline(val) {
  isOffline = val;
  document.getElementById('offline-banner').classList.toggle('visible', val);
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  renderBalance();
  renderList();
}

function renderBalance() {
  let emmaPaid = 0, ferdPaid = 0;
  expenses.forEach(e => {
    if (e.paid_by === 'Emma') emmaPaid += e.amount;
    else ferdPaid += e.amount;
  });
  const total    = emmaPaid + ferdPaid;
  const emmaOwes = total / 2 - emmaPaid;  // positive = Emma owes Ferdinand
  const diff     = Math.abs(emmaOwes);

  document.getElementById('total-spent').textContent = '€' + Math.round(total);
  document.getElementById('emma-paid').textContent   = '€' + Math.round(emmaPaid);
  document.getElementById('ferd-paid').textContent   = '€' + Math.round(ferdPaid);

  const balEl   = document.getElementById('balance-amount');
  const lblEl   = document.getElementById('balance-label');
  const arrowEl = document.getElementById('arrow-label');
  const btn     = document.getElementById('settle-btn');

  if (diff < 0.01) {
    balEl.textContent   = '€0.00';
    balEl.className     = 'balance-amount settled';
    lblEl.textContent   = 'all settled up';
    arrowEl.textContent = 'even';
    btn.style.display   = 'none';
    return;
  }

  btn.style.display = 'block';

  // emmaOwes > 0  → Emma owes Ferdinand
  // emmaOwes < 0  → Ferdinand owes Emma
  if (ACTIVE_USER === 'Emma') {
    balEl.textContent   = fmt(diff);
    balEl.className     = emmaOwes > 0 ? 'balance-amount owes' : 'balance-amount owed';
    lblEl.textContent   = emmaOwes > 0 ? `You owe ${OTHER_USER}` : `${OTHER_USER} owes you`;
    arrowEl.textContent = emmaOwes > 0 ? 'you → F' : 'F → you';
  } else if (ACTIVE_USER === 'Ferdinand') {
    const ferdOwes = -emmaOwes; // flip perspective
    balEl.textContent   = fmt(diff);
    balEl.className     = ferdOwes > 0 ? 'balance-amount owes' : 'balance-amount owed';
    lblEl.textContent   = ferdOwes > 0 ? `You owe ${OTHER_USER}` : `${OTHER_USER} owes you`;
    arrowEl.textContent = ferdOwes > 0 ? 'you → E' : 'E → you';
  } else {
    // Shared view — generic labels
    balEl.textContent   = fmt(diff);
    balEl.className     = emmaOwes > 0 ? 'balance-amount owes' : 'balance-amount owed';
    lblEl.textContent   = emmaOwes > 0 ? 'Emma owes Ferdinand' : 'Ferdinand owes Emma';
    arrowEl.textContent = emmaOwes > 0 ? 'E → F' : 'F → E';
  }
}

function renderList() {
  const list  = document.getElementById('expense-list');
  const empty = document.getElementById('empty-state');

  list.querySelectorAll('.expense-item').forEach(el => el.remove());

  if (expenses.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  [...expenses].reverse().forEach((exp) => {
    const each    = (exp.amount / 2).toFixed(2);
    const badge   = exp.paid_by === 'Emma' ? 'paid-e' : 'paid-f';
    const item    = document.createElement('div');

    item.className = 'expense-item' + (exp._pending ? ' pending' : '');
    item.innerHTML = `
      <div class="expense-icon">
        ${exp.category}
        ${exp._pending ? '<div class="spinner"></div>' : ''}
      </div>
      <div class="expense-desc">
        <div class="name">${exp.description}</div>
        <div class="meta">
          <span class="paid-badge ${badge}">${exp.paid_by}</span>
          ${exp.date ? fmtDate(exp.date) : 'Today'}
        </div>
      </div>
      <div class="expense-right">
        <div class="expense-total">${fmt(exp.amount)}</div>
        <div class="expense-split">€${each} each</div>
      </div>
      <button class="remove-btn" onclick="removeExpense('${exp.id}')" title="Remove">×</button>
    `;
    list.appendChild(item);
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function addExpense() {
  const desc     = document.getElementById('desc').value.trim();
  const amount   = parseFloat(document.getElementById('amount').value);
  const paid_by  = ACTIVE_USER || 'Emma'; // shared view falls back to Emma
  const category = document.getElementById('category').value;

  if (!desc || isNaN(amount) || amount <= 0) {
    setStatus('Please fill in a description and a valid amount.', 'err');
    return;
  }

  const today   = new Date().toISOString().slice(0, 10);
  const payload = { description: desc, amount, paid_by, category, date: today };

  const btn = document.getElementById('add-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';
  setStatus('');

  // Optimistic add — show item immediately with spinner
  const tempId = '_tmp_' + Date.now();
  expenses.push({ id: tempId, _pending: true, ...payload });
  render();

  try {
    const res = await fetch(API_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `Server error ${res.status}`);
    }

    const saved = await res.json();
    const idx   = expenses.findIndex(e => e.id === tempId);
    if (idx !== -1) expenses[idx] = saved;

    document.getElementById('desc').value   = '';
    document.getElementById('amount').value = '';
    setStatus('Expense added.', 'ok');
    setOffline(false);
    render();

  } catch (err) {
    console.error('POST /api/expenses failed:', err);
    // Keep item but strip spinner — greyed out = unsynced
    const idx = expenses.findIndex(e => e.id === tempId);
    if (idx !== -1) expenses[idx]._pending = false;
    setOffline(true);
    setStatus('Backend unreachable — saved locally.', 'err');
    render();

  } finally {
    btn.disabled    = false;
    btn.textContent = 'Add expense';
  }
}

async function loadExpenses() {
  try {
    const res = await fetch(API_ENDPOINT);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    expenses = await res.json();
    setOffline(false);
  } catch (err) {
    console.error('GET /api/expenses failed:', err);
    setOffline(true);
  }
  render();
}

async function removeExpense(id) {
  // Optimistic remove
  const prev = [...expenses];
  expenses = expenses.filter(e => e.id !== id);
  render();

  try {
    const res = await fetch(`${API_ENDPOINT}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    setOffline(false);
  } catch (err) {
    console.error(`DELETE /api/expenses/${id} failed:`, err);
    // Roll back
    expenses = prev;
    setOffline(true);
    render();
  }
}

function settle() {
  expenses = [];
  setOffline(false);
  render();
}

// ── Init ──────────────────────────────────────────────────────────────────────
personalise();
loadExpenses();
