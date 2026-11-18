// Dashboards for /alice (owner) and /nalani (therapist).
// Reads and writes through /api/dashboard; the passcode stays in this tab only.
(function () {
  'use strict';

  var ACCOUNT = document.body.getAttribute('data-account');
  var TOKEN_KEY = 'amb-dash-' + ACCOUNT;
  var DAY_ORDER = ['ww-fri', 'ww-sat', 'ww-sun', 'sf-fri', 'sf-sat', 'sf-sun'];
  var DAY_GROUPS = [
    { id: 'all', label: 'Everything' },
    { id: 'ww', label: 'Wellness Weekend' },
    { id: 'sf', label: 'Salmonfest' }
  ];
  var app = document.getElementById('app');
  var who = document.getElementById('who');

  var state = {
    token: read(TOKEN_KEY),
    data: null,
    error: '',
    busy: false,
    tab: 'bookings',
    dayFilter: 'all',
    waitFilter: 'active',
    open: {}
  };

  // ---- helpers ------------------------------------------------------------

  function read(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function write(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) {} }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(cents) {
    var d = (cents || 0) / 100;
    return '$' + (d % 1 ? d.toFixed(2) : String(d)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function hours(min) {
    var h = (min || 0) / 60;
    return (h % 1 ? h.toFixed(1) : String(h)) + ' h';
  }
  function minClock(m) {
    var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'pm' : 'am';
    return ((h + 11) % 12 + 1) + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap;
  }
  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function clockOf(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function bySchedule(a, b) {
    var da = DAY_ORDER.indexOf(a.dayId), db = DAY_ORDER.indexOf(b.dayId);
    return da !== db ? da - db : (a.startMin || 0) - (b.startMin || 0);
  }
  function when(b) {
    return '<div class="strong">' + esc(b.day || b.dayId) + '</div><div class="sub">' +
      esc(b.slot || minClock(b.startMin)) + ' – ' + esc(minClock((b.startMin || 0) + (b.minutes || 0))) + '</div>';
  }
  function handsWord(n) { return n === 1 ? 'Two hands' : n === 2 ? 'Four hands' : 'Six hands'; }
  function telLink(contact) {
    var c = String(contact || '');
    if (c.indexOf('@') > -1) return '<a href="mailto:' + esc(c) + '">' + esc(c) + '</a>';
    var digits = c.replace(/[^\d+]/g, '');
    return digits.length >= 7 ? '<a href="tel:' + esc(digits) + '">' + esc(c) + '</a>' : esc(c);
  }

  var toastTimer;
  function toast(msg, bad) {
    var el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle('bad', !!bad);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  // ---- api ----------------------------------------------------------------

  function api(method, body) {
    return fetch('/api/dashboard?account=' + encodeURIComponent(ACCOUNT), {
      method: method,
      headers: Object.assign({ 'x-admin-token': state.token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
        return data;
      });
    });
  }

  function load(quiet) {
    if (!state.token) { render(); return; }
    if (!quiet) { state.busy = true; render(); }
    return api('GET').then(function (data) {
      state.data = data; state.error = ''; state.busy = false;
      write(TOKEN_KEY, state.token);
      render();
    }).catch(function (err) {
      state.busy = false;
      if (err.status === 401) { state.token = ''; write(TOKEN_KEY, ''); state.data = null; }
      state.error = err.message;
      if (quiet && state.data) toast(err.message, true); else render();
    });
  }

  function change(body, okMsg) {
    return api('POST', body).then(function (data) {
      state.data = data; render(); if (okMsg) toast(okMsg);
    }).catch(function (err) { toast(err.message, true); render(); });
  }

  // ---- views --------------------------------------------------------------

  function render() {
    var focusId = document.activeElement && document.activeElement.id;
    if (!state.data) { renderLogin(); }
    else if (state.data.role === 'owner') { renderOwner(state.data); }
    else { renderTherapist(state.data); }
    if (focusId) { var el = document.getElementById(focusId); if (el) el.focus(); }
  }

  function renderLogin() {
    who.hidden = true;
    var title = ACCOUNT === 'alice' ? 'Owner dashboard' : 'Your dashboard';
    app.innerHTML =
      '<p class="eyebrow">Band only</p><h1>' + esc(title) + '</h1>' +
      '<p class="lede">' + (ACCOUNT === 'alice'
        ? 'Every booking, the day-of waitlist, and what each therapist is owed.'
        : 'Your sessions and what you’re owed for them.') + '</p>' +
      '<form class="card login" id="login">' +
        '<label for="pass">Passcode<input id="pass" type="password" autocomplete="current-password" required></label>' +
        '<button class="btn primary" type="submit"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Checking…' : 'Open dashboard') + '</button>' +
        (state.error ? '<p class="error" role="alert">' + esc(state.error) + '</p>' : '') +
      '</form>';
    if (!state.busy) document.getElementById('pass').focus();
  }

  function header(name, roleLabel) {
    who.hidden = false;
    who.innerHTML = '<span>' + esc(name) + ' · <span class="muted">' + esc(roleLabel) + '</span></span>' +
      '<button class="btn quiet small" type="button" data-action="logout">Log out</button>';
  }

  function stats(items) {
    return '<div class="stats">' + items.map(function (s) {
      return '<div class="stat"><div class="label">' + esc(s[0]) + '</div><div class="value">' + esc(s[1]) + '</div></div>';
    }).join('') + '</div>';
  }

  // ---- owner --------------------------------------------------------------

  function renderOwner(d) {
    header(d.name, 'Owner');
    var bookings = d.bookings.slice().sort(bySchedule);
    var waiting = d.waitlist.filter(function (w) { return w.status === 'waiting'; });
    var activeWait = d.waitlist.filter(function (w) { return w.status === 'waiting' || w.status === 'called'; });
    var unassigned = bookings.filter(function (b) { return b.assigned.indexOf('') > -1; }).length;
    var owed = d.payouts.reduce(function (s, p) { return s + p.owedCents; }, 0);

    var tabs = [
      ['bookings', 'Bookings', bookings.length],
      ['waitlist', 'Waitlist', activeWait.length],
      ['payouts', 'Payouts', null]
    ];

    var html =
      '<p class="eyebrow">Owner dashboard</p><h1>Hi, ' + esc(d.name.split(' ')[0]) + '.</h1>' +
      '<p class="lede">Everything booked through the site and everyone on today’s waitlist. Walk-ups you take at the booth won’t show here.</p>' +
      stats([
        ['Sessions booked', String(bookings.length)],
        ['Booked value', money(sum(bookings, 'totalCents'))],
        ['Paid online', money(sum(bookings, 'paidOnlineCents'))],
        ['Due at the booth', money(sum(bookings, 'balanceCents'))],
        ['Waiting now', String(waiting.length)],
        ['Owed to therapists', money(owed)]
      ]) +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button class="tab" role="tab" id="tab-' + t[0] + '" aria-selected="' + (state.tab === t[0]) + '" data-action="tab" data-tab="' + t[0] + '">' +
          esc(t[1]) + (t[2] != null ? '<span class="count">' + t[2] + '</span>' : '') + '</button>';
      }).join('') + '</div>';

    if (state.tab === 'bookings') html += ownerBookings(d, bookings, unassigned);
    if (state.tab === 'waitlist') html += ownerWaitlist(d);
    if (state.tab === 'payouts') html += ownerPayouts(d, bookings);
    app.innerHTML = '<div role="tabpanel" aria-labelledby="tab-' + state.tab + '">' + html + '</div>';
  }

  function sum(list, key) { return list.reduce(function (s, b) { return s + (b[key] || 0); }, 0); }

  function refreshButton() {
    return '<button class="btn" type="button" data-action="refresh">' + (state.busy ? 'Refreshing…' : 'Refresh') + '</button>';
  }

  function ownerBookings(d, bookings, unassigned) {
    var shown = bookings.filter(function (b) { return state.dayFilter === 'all' || b.dayId.indexOf(state.dayFilter) === 0; });
    var html = '<div class="toolbar">' + DAY_GROUPS.map(function (g) {
      return '<button class="chip" type="button" aria-pressed="' + (state.dayFilter === g.id) + '" data-action="day" data-day="' + g.id + '">' + esc(g.label) + '</button>';
    }).join('') + '<div class="end">' + refreshButton() + '</div></div>';
    if (unassigned) html += '<p class="notice">' + unassigned + ' session' + (unassigned === 1 ? ' still needs' : 's still need') + ' a therapist. Pick one in the Therapists column so it shows on their dashboard.</p>';

    html += '<div class="table"><div class="row head cols-bookings"><div>When</div><div>Guest</div><div>Session</div><div>Therapists</div><div>Money</div></div>';
    if (!shown.length) html += '<div class="empty">No bookings yet.</div>';
    shown.forEach(function (b) {
      html += '<div class="row cols-bookings">' +
        '<div data-label="When">' + when(b) + '</div>' +
        '<div data-label="Guest"><div class="strong">' + esc(b.name) + '</div><div class="sub">' + telLink(b.contact) + '</div></div>' +
        '<div data-label="Session"><div>' + esc(b.session) + '</div><div class="sub">' + b.minutes + ' min · ' + handsWord(b.hands) +
          (b.requested !== 'any' ? ' · asked for ' + esc(b.requested) : '') + '</div>' +
          (b.notes ? '<div class="sub">“' + esc(b.notes) + '”</div>' : '') + '</div>' +
        '<div data-label="Therapists">' + b.assigned.map(function (name, i) {
          var id = 'seat-' + b.id + '-' + i;
          return '<label class="seat" for="' + esc(id) + '">' + (b.hands > 1 ? 'Therapist ' + (i + 1) : 'Therapist') +
            '<select id="' + esc(id) + '" data-action="assign" data-id="' + esc(b.id) + '" data-seat="' + i + '">' +
            '<option value="">Not assigned</option>' + d.therapists.map(function (t) {
              return '<option' + (t === name ? ' selected' : '') + '>' + esc(t) + '</option>';
            }).join('') + '</select></label>';
        }).join('') + '</div>' +
        '<div data-label="Money" class="money">' +
          '<div class="total"><span>Total</span><span>' + money(b.totalCents) + '</span></div>' +
          '<div><span>' + (b.mode === 'full' ? 'Paid online' : 'Deposit hold') + '</span><span>' + money(b.paidOnlineCents) + '</span></div>' +
          '<div><span>At the booth</span><span>' + money(b.balanceCents) + '</span></div>' +
        '</div></div>';
    });
    return html + '</div>';
  }

  function ownerWaitlist(d) {
    var list = d.waitlist.filter(function (w) {
      return state.waitFilter === 'all' || w.status === 'waiting' || w.status === 'called';
    });
    var place = 0;
    var html = '<div class="toolbar">' +
      '<button class="chip" type="button" aria-pressed="' + (state.waitFilter === 'active') + '" data-action="waitfilter" data-filter="active">Still waiting</button>' +
      '<button class="chip" type="button" aria-pressed="' + (state.waitFilter === 'all') + '" data-action="waitfilter" data-filter="all">Everyone</button>' +
      '<div class="end"><span class="sub">Updates every 30 seconds</span>' + refreshButton() + '</div></div>';
    html += '<div class="table"><div class="row head cols-wait"><div>#</div><div>Name</div><div>Mobile</div><div>Joined</div><div>Status</div><div>Update</div></div>';
    if (!list.length) html += '<div class="empty">' + (state.waitFilter === 'all' ? 'Nobody has joined the waitlist yet.' : 'Nobody is waiting right now.') + '</div>';
    list.forEach(function (w) {
      var active = w.status === 'waiting';
      if (active) place++;
      var btn = function (status, label) {
        return '<button class="btn small" type="button" data-action="wait" data-id="' + esc(w.id) + '" data-status="' + status + '">' + label + '</button>';
      };
      var actions = w.status === 'waiting' ? btn('called', 'Called') + btn('served', 'Served') + btn('removed', 'Remove')
        : w.status === 'called' ? btn('served', 'Served') + btn('waiting', 'Back in line') + btn('removed', 'Remove')
        : btn('waiting', 'Back in line');
      html += '<div class="row cols-wait' + (w.status === 'served' || w.status === 'removed' ? ' faded' : '') + '">' +
        '<div data-label="Place" class="strong">' + (active ? place : '–') + '</div>' +
        '<div data-label="Name" class="strong">' + esc(w.name) + '</div>' +
        '<div data-label="Mobile">' + telLink(w.contact) + '</div>' +
        '<div data-label="Joined" class="sub">' + esc(clockOf(w.createdAt)) + '</div>' +
        '<div data-label="Status"><span class="badge ' + esc(w.status) + '">' + esc(w.status) + '</span></div>' +
        '<div data-label="Update" class="actions">' + actions + '</div></div>';
    });
    return html + '</div>';
  }

  function ownerPayouts(d, bookings) {
    var html = '<form class="settings" id="settings">' +
      '<label for="pct">Therapist payout<input id="pct" type="number" min="0" max="100" step="1" value="' + d.settings.payoutPercent + '"></label>' +
      '<span class="sub" style="padding-bottom:12px">% of $2/min for each therapist’s time</span>' +
      '<button class="btn" type="submit">Save</button></form>';
    html += '<div class="people">';
    d.payouts.forEach(function (p) {
      var mine = bookings.filter(function (b) { return b.assigned.indexOf(p.name) > -1; });
      var key = 'p-' + p.name;
      html += '<details class="person" data-key="' + esc(key) + '"' + (state.open[key] ? ' open' : '') + '>' +
        '<summary><span class="name">' + esc(p.name) + '</span>' +
          figure('Sessions', p.sessions) + figure('Table time', hours(p.minutes)) +
          figure('Earned', money(p.earnedCents)) + figure('Still owed', money(p.owedCents)) +
          '<span class="chev" aria-hidden="true">▸</span></summary><div class="inner">';
      if (!mine.length) html += '<p class="muted">No sessions assigned yet.</p>';
      else {
        html += '<div class="toolbar"><div class="end">' + (p.owedCents
          ? '<button class="btn" type="button" data-action="payall" data-name="' + esc(p.name) + '">Mark all ' + money(p.owedCents) + ' paid</button>'
          : '<span class="badge paid">All paid</span>') + '</div></div>';
        html += '<div class="table"><div class="row head cols-pay"><div>When</div><div>Session</div><div>Share</div><div>Status</div><div></div></div>';
        mine.forEach(function (b) {
          var seats = b.assigned.filter(function (n) { return n === p.name; }).length;
          var paidAt = b.paidOut[p.name];
          html += '<div class="row cols-pay">' +
            '<div data-label="When">' + when(b) + '</div>' +
            '<div data-label="Session">' + esc(b.session) + '<div class="sub">' + b.minutes + ' min · ' + esc(b.name) + '</div></div>' +
            '<div data-label="Share" class="strong">' + money(b.shareCents * seats) + '</div>' +
            '<div data-label="Status">' + (paidAt ? '<span class="badge paid">Paid ' + esc(shortDate(paidAt)) + '</span>' : '<span class="badge owed">Owed</span>') + '</div>' +
            '<div class="actions"><button class="btn small" type="button" data-action="pay" data-id="' + esc(b.id) + '" data-name="' + esc(p.name) + '" data-paid="' + (paidAt ? '0' : '1') + '">' +
              (paidAt ? 'Undo' : 'Mark paid') + '</button></div></div>';
        });
        html += '</div>';
      }
      html += '</div></details>';
    });
    return html + '</div>';
  }

  function figure(label, value) {
    return '<span class="figure"><span class="label">' + esc(label) + '</span><br><span class="value">' + esc(value) + '</span></span>';
  }

  // ---- therapist ----------------------------------------------------------

  function renderTherapist(d) {
    header(d.name, 'Therapist');
    var list = d.bookings.slice().sort(bySchedule);
    var s = d.summary;
    var html =
      '<p class="eyebrow">Your dashboard</p><h1>Hi, ' + esc(d.name.split(' ')[0]) + '.</h1>' +
      '<p class="lede">The sessions you’re on and what you’re owed. Your share is ' + d.payoutPercent + '% of $' + d.ratePerMinute +
        '/min for your time on each one. Alice marks shares paid when she pays you.</p>' +
      stats([
        ['Sessions', String(s.sessions)],
        ['Table time', hours(s.minutes)],
        ['Earned', money(s.earnedCents)],
        ['Paid to you', money(s.paidCents)],
        ['Still owed', money(s.owedCents)]
      ]) +
      '<div class="toolbar"><h2 style="margin:0">Your sessions</h2><div class="end">' + refreshButton() + '</div></div>' +
      '<div class="table"><div class="row head cols-mine"><div>When</div><div>Guest</div><div>Session</div><div>Your share</div><div>Status</div></div>';
    if (!list.length) html += '<div class="empty">No sessions assigned to you yet. Alice assigns them from her dashboard.</div>';
    list.forEach(function (b) {
      html += '<div class="row cols-mine">' +
        '<div data-label="When">' + when(b) + '</div>' +
        '<div data-label="Guest"><div class="strong">' + esc(b.name) + '</div><div class="sub">' + telLink(b.contact) + '</div></div>' +
        '<div data-label="Session"><div>' + esc(b.session) + '</div><div class="sub">' + b.minutes + ' min · ' + handsWord(b.hands) +
          (b.with.length ? ' with ' + esc(b.with.join(', ')) : '') + '</div>' +
          (b.notes ? '<div class="sub">“' + esc(b.notes) + '”</div>' : '') + '</div>' +
        '<div data-label="Your share" class="strong">' + money(b.shareCents) + '</div>' +
        '<div data-label="Status">' + (b.paidOutAt ? '<span class="badge paid">Paid ' + esc(shortDate(b.paidOutAt)) + '</span>' : '<span class="badge owed">Owed</span>') + '</div>' +
        '</div>';
    });
    app.innerHTML = html + '</div>';
  }

  // ---- events -------------------------------------------------------------

  document.addEventListener('submit', function (e) {
    if (e.target.id === 'login') {
      e.preventDefault();
      state.token = document.getElementById('pass').value.trim();
      if (state.token) load();
    }
    if (e.target.id === 'settings') {
      e.preventDefault();
      change({ action: 'settings', payoutPercent: Number(document.getElementById('pct').value) }, 'Payout saved');
    }
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT') return;
    var a = el.getAttribute('data-action');
    if (a === 'logout') { state.token = ''; state.data = null; state.error = ''; write(TOKEN_KEY, ''); render(); }
    if (a === 'refresh') load(true).then(function () { toast('Up to date'); });
    if (a === 'tab') { state.tab = el.getAttribute('data-tab'); render(); }
    if (a === 'day') { state.dayFilter = el.getAttribute('data-day'); render(); }
    if (a === 'waitfilter') { state.waitFilter = el.getAttribute('data-filter'); render(); }
    if (a === 'wait') change({ action: 'waitlist', id: el.getAttribute('data-id'), status: el.getAttribute('data-status') });
    if (a === 'pay') change({ action: 'payout', id: el.getAttribute('data-id'), therapist: el.getAttribute('data-name'), paid: el.getAttribute('data-paid') === '1' });
    if (a === 'payall' && window.confirm('Mark everything owed to ' + el.getAttribute('data-name') + ' as paid?')) {
      change({ action: 'payoutAll', therapist: el.getAttribute('data-name') }, 'Marked paid');
    }
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.getAttribute('data-action') !== 'assign') return;
    var id = el.getAttribute('data-id');
    var booking = state.data.bookings.filter(function (b) { return b.id === id; })[0];
    var assigned = booking.assigned.slice();
    assigned[Number(el.getAttribute('data-seat'))] = el.value;
    change({ action: 'assign', id: id, assigned: assigned }, el.value ? 'Assigned ' + el.value : 'Unassigned');
  });

  document.addEventListener('toggle', function (e) {
    if (e.target.matches && e.target.matches('details.person')) state.open[e.target.getAttribute('data-key')] = e.target.open;
  }, true);

  // Keep the owner's waitlist fresh while the page is open.
  setInterval(function () {
    if (state.data && state.data.role === 'owner' && state.tab === 'waitlist' && !document.hidden) load(true);
  }, 30000);

  load();
})();
