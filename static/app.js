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
// Falls back to null on the shared / view.
const metaUser    = document.querySelector('meta[name="active-user"]');
const ACTIVE_USER = metaUser ? metaUser.content : null; // "Emma" | "Ferdinand" | null
const OTHER_USER  = ACTIVE_USER === 'Emma'      ? 'Ferdinand'
                  : ACTIVE_USER === 'Ferdinand' ? 'Emma'
                  : null;

let expenses     = [];
let isOffline    = false;
let confirmingId = null; // tracks which item is showing the confirm prompt

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

  const meEl = ACTIVE_USER === 'Emma'
    ? document.getElementById('avatar-e')
    : document.getElementById('avatar-f');
  meEl.style.outline       = '2px solid currentColor';
  meEl.style.outlineOffset = '2px';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function removeBtn(id) {
  if (confirmingId === id) {
    return `<div class="confirm-delete">
      <button class="confirm-no"  onclick="cancelDelete()">Cancel</button>
      <button class="confirm-yes" onclick="removeExpense('${id}')">Delete</button>
    </div>`;
  }
  return `<button class="remove-btn" onclick="confirmDelete('${id}')" title="Remove">×</button>`;
}

// ── Balance calculation ───────────────────────────────────────────────────────

// Returns { emmaOwes, total, emmaExpenses, ferdExpenses }
// emmaOwes > 0 → Emma owes Ferdinand
// emmaOwes < 0 → Ferdinand owes Emma
function calcBalance() {
  let emmaExpenses = 0, ferdExpenses = 0;
  let emmaSettled  = 0, ferdSettled  = 0;

  expenses.forEach(e => {
    if (e._pending || e._failed) return; // exclude unconfirmed items from balance

    if (e.category === 'settlement') {
      if (e.paid_by === 'Emma') emmaSettled += e.amount;
      else                       ferdSettled  += e.amount;
      return;
    }
    if (e.paid_by === 'Emma') emmaExpenses += e.amount;
    else                       ferdExpenses += e.amount;
  });

  const total    = emmaExpenses + ferdExpenses;
  const emmaOwes = ferdExpenses / 2 - emmaExpenses / 2 - emmaSettled + ferdSettled;

  return { emmaOwes, total, emmaExpenses, ferdExpenses };
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  renderBalance();
  renderList();
}

function renderBalance() {
  const { emmaOwes, total, emmaExpenses, ferdExpenses } = calcBalance();
  const diff = Math.abs(emmaOwes);

  document.getElementById('total-spent').textContent = fmt(total);

  // "me" = the active user, "other" = the counterpart.
  // On the shared view ACTIVE_USER is null so we fall back to Emma/Ferdinand labels.
  const mePaid    = ACTIVE_USER === 'Ferdinand' ? ferdExpenses : emmaExpenses;
  const otherPaid = ACTIVE_USER === 'Ferdinand' ? emmaExpenses : ferdExpenses;
  document.getElementById('me-paid').textContent    = fmt(mePaid);
  document.getElementById('other-paid').textContent = fmt(otherPaid);

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

  if (ACTIVE_USER === 'Emma') {
    balEl.textContent   = fmt(diff);
    balEl.className     = emmaOwes > 0 ? 'balance-amount owes' : 'balance-amount owed';
    lblEl.textContent   = emmaOwes > 0 ? `You owe ${OTHER_USER}` : `${OTHER_USER} owes you`;
    arrowEl.textContent = emmaOwes > 0 ? 'you → F' : 'F → you';
  } else if (ACTIVE_USER === 'Ferdinand') {
    const ferdOwes = -emmaOwes;
    balEl.textContent   = fmt(diff);
    balEl.className     = ferdOwes > 0 ? 'balance-amount owes' : 'balance-amount owed';
    lblEl.textContent   = ferdOwes > 0 ? `You owe ${OTHER_USER}` : `${OTHER_USER} owes you`;
    arrowEl.textContent = ferdOwes > 0 ? 'you → E' : 'E → you';
  } else {
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
    const item       = document.createElement('div');
    const isPending  = !!exp._pending;
    const isFailed   = !!exp._failed;
    const stateClass = isPending ? ' pending' : isFailed ? ' failed' : '';

    if (exp.category === 'settlement') {
      item.className = 'expense-item settlement-row' + stateClass;
      item.innerHTML = `
        <div class="settlement-icon">
          ${isPending ? '<div class="spinner-sm"></div>' : '✓'}
        </div>
        <div class="expense-desc">
          <div class="name settlement-name">
            Settlement
            <span class="settlement-meta">${exp.paid_by} paid ${exp.paid_by === 'Emma' ? 'Ferdinand' : 'Emma'}&nbsp;&nbsp;${exp.date ? fmtDate(exp.date) : 'Today'}</span>
          </div>
        </div>
        <div class="expense-right">
          <div class="expense-total settlement-amount">${fmt(exp.amount)}</div>
        </div>
        ${isFailed  ? `<button class="retry-btn" onclick="retryExpense('${exp._tempId}')" title="Retry">↺</button>`
        : isPending ? ''
        :              removeBtn(exp.id)}
      `;
    } else {
      const each  = (exp.amount / 2).toFixed(2);
      const badge = exp.paid_by === 'Emma' ? 'paid-e' : 'paid-f';
      item.className = 'expense-item' + stateClass;
      item.innerHTML = `
        <div class="expense-icon">
          ${isPending ? '<div class="spinner"></div>' : exp.category}
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
        ${isFailed  ? `<button class="retry-btn" onclick="retryExpense('${exp._tempId}')" title="Retry">↺</button>`
        : isPending ? ''
        :              removeBtn(exp.id)}
      `;
    }
    list.appendChild(item);
  });
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function postExpense(payload, tempId) {
  const idx = expenses.findIndex(e => e._tempId === tempId);

  try {
    const res = await fetch(API_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);

    const saved = await res.json();
    if (idx !== -1) expenses[idx] = saved;
    setOffline(false);

  } catch (err) {
    console.error('POST /api/expenses failed:', err);
    if (idx !== -1) {
      expenses[idx]._pending = false;
      expenses[idx]._failed  = true;
    }
    setOffline(true);
  }

  render();
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function addExpense() {
  const desc     = document.getElementById('desc').value.trim();
  const amount   = parseFloat(document.getElementById('amount').value);
  const paid_by  = ACTIVE_USER || 'Emma';
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

  // Optimistic add — show immediately as pending (greyed out + spinner)
  const tempId = '_tmp_' + Date.now();
  expenses.push({ id: tempId, _tempId: tempId, _pending: true, ...payload });
  render();

  await postExpense(payload, tempId);

  setStatus(isOffline ? 'Could not reach server — will retry.' : 'Expense added.', isOffline ? 'err' : 'ok');
  document.getElementById('desc').value   = '';
  document.getElementById('amount').value = '';
  btn.disabled    = false;
  btn.textContent = 'Add expense';
}

async function retryExpense(tempId) {
  const exp = expenses.find(e => e._tempId === tempId);
  if (!exp) return;

  const payload = {
    description: exp.description,
    amount:      exp.amount,
    paid_by:     exp.paid_by,
    category:    exp.category,
    date:        exp.date,
  };

  exp._pending = true;
  exp._failed  = false;
  render();

  await postExpense(payload, tempId);
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

function confirmDelete(id) {
  confirmingId = id;
  render();
}

function cancelDelete() {
  confirmingId = null;
  render();
}

async function removeExpense(id) {
  confirmingId = null;
  const prev = [...expenses];
  expenses = expenses.filter(e => e.id !== id);
  render();

  try {
    const res = await fetch(`${API_ENDPOINT}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    setOffline(false);
  } catch (err) {
    console.error(`DELETE /api/expenses/${id} failed:`, err);
    expenses = prev;
    setOffline(true);
    render();
  }
}

async function settle() {
  const { emmaOwes } = calcBalance();

  const amount  = parseFloat(Math.abs(emmaOwes).toFixed(2));
  const paid_by = emmaOwes > 0 ? 'Emma' : 'Ferdinand';
  const today   = new Date().toISOString().slice(0, 10);
  const payload = { description: 'Settlement', amount, paid_by, category: 'settlement', date: today };

  const btn = document.getElementById('settle-btn');
  btn.disabled    = true;
  btn.textContent = 'Settling…';

  const tempId = '_tmp_' + Date.now();
  expenses.push({ id: tempId, _tempId: tempId, _pending: true, ...payload });
  render();

  await postExpense(payload, tempId);

  btn.disabled    = false;
  btn.textContent = 'Mark settled';
}

// ── Init ──────────────────────────────────────────────────────────────────────
personalise();
loadExpenses();
