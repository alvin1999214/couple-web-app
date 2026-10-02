const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icon = (name, className = "") => `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

document.documentElement.classList.toggle(
  "standalone-app",
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true,
);

let categories = {
  groceries: { label: "日常購物", color: "#ff8e7a", icon: "basket", is_default: 1 },
  dining: { label: "外出用餐", color: "#f6bd61", icon: "utensils", is_default: 1 },
  home: { label: "居家生活", color: "#8ec5a7", icon: "home", is_default: 1 },
  utilities: { label: "水電煤", color: "#9ba5e8", icon: "bolt", is_default: 1 },
  transport: { label: "交通", color: "#62b3c4", icon: "train", is_default: 1 },
  leisure: { label: "約會娛樂", color: "#d99cc8", icon: "sparkles", is_default: 1 },
  other: { label: "其他", color: "#a8a59e", icon: "dots", is_default: 1 },
};

function syncCategories(list) {
  if (Array.isArray(list)) {
    categories = {};
    list.forEach((c) => {
      categories[c.key] = {
        label: c.label,
        color: c.color || "#a8a59e",
        icon: c.icon || "dots",
        is_default: c.is_default,
      };
    });
    if (state.category !== "all" && !categories[state.category]) state.category = "all";
    updateCategoryDropdowns();
  }
}

function updateCategoryDropdowns() {
  const select = $("#expense-category-filter");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="all">全部類別</option>' + Object.entries(categories).map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`).join("");
  select.value = categories[current] || current === "all" ? current : "all";
}


const widgetMeta = {
  budget: { title: "本月共同開支", icon: "wallet" },
  balance: { title: "彼此分帳", icon: "spark" },
  shopping: { title: "購物清單", icon: "cart" },
  todo: { title: "日常待辦", icon: "check" },
  moments: { title: "特別日子", icon: "calendar" },
  insight: { title: "生活小洞察", icon: "spark" },
};

const state = {
  data: null,
  month: localMonth(),
  period: "month",
  category: "all",
  editing: false,
  draggedId: null,
  submitting: false,
  loadSequence: 0,
};

function esc(value = "") {
  const element = document.createElement("div");
  element.textContent = String(value);
  return element.innerHTML.replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function money(value, digits = 0) {
  return new Intl.NumberFormat(state.data?.preferences?.locale || "zh-HK", {
    style: "currency",
    currency: state.data?.preferences?.currency || "HKD",
    maximumFractionDigits: digits,
  }).format(Number(value || 0));
}

function shortDate(value) {
  if (!value) return "沒有期限";
  const parsed = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((parsed - today) / 86400000);
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  if (days > 1 && days < 7) return `${days} 天後`;
  if (days === -1) return "昨天";
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function monthLabel(month) {
  const [year, value] = month.split("-").map(Number);
  const currentYear = new Date().getFullYear();
  return year === currentYear ? `${value} 月` : `${year} 年 ${value} 月`;
}

function expenseDate(value) {
  if (!value) return "日期未設定";
  const parsed = new Date(`${value}T00:00:00`);
  return parsed.toLocaleDateString(state.data?.preferences?.locale || "zh-HK", {
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
  });
}

function localMonth() {
  return localISODate().slice(0, 7);
}

function filterPeriodLabel(period = state.data?.filter?.period || state.period) {
  return ({ today: "今天", week: "本週", month: monthLabel(state.month), last7: "最近 7 天", last30: "最近 30 天" })[period] || "本月";
}

function filterScopeLabel() {
  const period = filterPeriodLabel();
  const category = state.category === "all" ? "全部類別" : categories[state.category]?.label || "其他";
  return `${period} · ${category}`;
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const { headers = {}, signal, timeoutMs = 8000, ...requestOptions } = options;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(path, {
      ...requestOptions,
      headers: { "Content-Type": "application/json", ...headers },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => {
      throw new Error("伺服器回應不完整，未能確認結果");
    });
    if (!response.ok) throw Object.assign(new Error(payload.error || "連線發生問題"), {
      code: payload.code, duplicates: payload.duplicates, status: response.status,
    });
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("連線已取消或逾時，請重試");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

async function loadDashboard({ quiet = false, throwOnError = false } = {}) {
  const sequence = ++state.loadSequence;
  const params = new URLSearchParams({
    month: state.month,
    period: state.period,
    category: state.category,
    today: localISODate(),
  });
  $(".expense-filters")?.classList.add("loading");
  try {
    const data = await api(`/api/dashboard?${params}`);
    if (sequence !== state.loadSequence) return;
    if (!data.configured) {
      state.data = null;
      showOnboarding();
      return;
    }
    state.data = data;
    if (data.categories) syncCategories(data.categories);
    state.month = data.month;
    state.period = data.filter?.period || "month";
    state.category = data.filter?.category || "all";
    showApp();
    updateIdentity();
    setupTime();
    renderDashboard();

  } catch (error) {
    if (sequence !== state.loadSequence) return;
    if (throwOnError) throw error;
    if (!quiet) {
      showApp();
      renderLoadError(error.message);
    }
    else toast(error.message, true);
  } finally {
    if (sequence === state.loadSequence) $(".expense-filters")?.classList.remove("loading");
  }
}

function showOnboarding() {
  clearTimeout(window.__teletubbylandBootFallback);
  $("#boot-screen").hidden = true;
  $("#app-shell").hidden = true;
  $("#mobile-nav").hidden = true;
  $("#onboarding").hidden = false;
  document.body.classList.add("onboarding-active");
  $("#setup-started").max = localISODate();
  setTimeout(() => $("#setup-name-one").focus(), 250);
}

function showApp() {
  clearTimeout(window.__teletubbylandBootFallback);
  $("#boot-screen").hidden = true;
  $("#onboarding").hidden = true;
  $("#app-shell").hidden = false;
  $("#mobile-nav").hidden = false;
  document.body.classList.remove("onboarding-active");
}

function updateIdentity() {
  const names = state.data.settings.couple_names;
  $("#welcome-names").textContent = names.join(" & ");
  $$(".avatar-a, .mini-avatars span:first-child").forEach((el) => { el.textContent = names[0].slice(0, 1).toUpperCase(); });
  $$(".avatar-b, .mini-avatars span:last-child").forEach((el) => { el.textContent = names[1].slice(0, 1).toUpperCase(); });
}

function renderDashboard() {
  const grid = $("#dashboard-grid");
  const layout = normalizeLayout(state.data.layout);
  state.data.layout = layout;
  grid.innerHTML = layout.map((item, index) => renderWidget(item, index)).join("");
  grid.classList.toggle("editing", state.editing);
  setupDragAndDrop();
  updateExpenseFilters();
  updateSpecialDayNotification();
  requestAnimationFrame(() => {
    const donut = $(".donut");
    if (donut) donut.style.setProperty("--progress", `${Math.min(100, state.data.month_expense_total / state.data.settings.monthly_budget * 100) * 3.6}deg`);
  });
}

function updateExpenseFilters() {
  $("#global-month").value = state.month;
  $("#expense-category-filter").value = state.category;
  $$('[data-expense-period]').forEach((button) => {
    const active = button.dataset.expensePeriod === state.period;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#filter-status").textContent = `${filterScopeLabel()} · ${state.data.expense_count} 筆`;
  $("#reset-expense-filter").hidden = state.period === "month" && state.category === "all" && state.month === localMonth();
}

function normalizeLayout(layout) {
  const provided = Array.isArray(layout) ? layout : [];
  const result = provided.filter((item) => widgetMeta[item.id]);
  Object.keys(widgetMeta).forEach((id) => {
    if (!result.some((item) => item.id === id)) result.push({ id, size: "medium", hidden: false, order: result.length });
  });
  return result.sort((a, b) => a.order - b.order).map((item, order) => ({ ...item, order }));
}

function renderWidget(layout, index) {
  const renderers = { budget: renderBudget, balance: renderBalance, shopping: renderShopping, todo: renderTodo, moments: renderMoments, insight: renderInsight };
  const content = renderers[layout.id]();
  return `<article id="${layout.id}" class="widget ${widgetClass(layout.id)} size-${layout.size} ${layout.hidden ? "hidden-widget" : ""}" data-widget-id="${layout.id}" data-size="${layout.size}" draggable="${state.editing}" style="animation-delay:${index * 45}ms">
    <div class="widget-edit-controls">
      <button data-layout-action="resize" title="調整尺寸" aria-label="調整尺寸">${icon("resize")}</button>
      <button class="move-up" data-layout-action="up" title="向前移動" aria-label="向前移動">${icon("chevron")}</button>
      <button class="move-down" data-layout-action="down" title="向後移動" aria-label="向後移動">${icon("chevron")}</button>
      <button data-layout-action="hide" title="隱藏卡片" aria-label="隱藏卡片">${icon("eyeoff")}</button>
    </div>
    ${content}
  </article>`;
}

function widgetClass(id) {
  return ({ budget: "budget-widget", balance: "balance-widget", shopping: "list-widget", todo: "list-widget", moments: "moments-widget", insight: "insight-widget" })[id] || "";
}

function header(title, subtitle, iconName, tone = "", action = "") {
  return `<header class="widget-header">
    <div class="widget-title"><span class="widget-title-icon ${tone}">${icon(iconName)}</span><div><h2>${title}</h2><div class="widget-subtitle">${subtitle}</div></div></div>
    ${action || `<button class="more-button" aria-label="更多">${icon("more")}</button>`}
  </header>`;
}

function renderBudget() {
  const { expense_total: filteredTotal, month_expense_total: monthTotal, expense_count: count, settings, expenses, month, filter } = state.data;
  const budget = settings.monthly_budget;
  const remaining = budget - monthTotal;
  const rows = expenses.length ? expenses.map((item) => {
    const meta = categories[item.category] || { label: item.category, color: "#a8a59e", icon: "dots" };
    return `<div class="expense-row">
      <span class="category-dot" style="background:${meta.color}"></span>
      <span class="expense-info"><strong>${esc(item.title)}</strong><small>${expenseDate(item.spent_on)} · ${meta.label} · ${esc(item.paid_by)}${item.has_invoice ? ` · <a href="/api/expenses/${item.id}/invoice" target="_blank" rel="noopener">單據</a>` : ""}</small></span>
      <span class="expense-amount">${money(item.amount)}</span>
      <span class="expense-actions">
        <button class="delete-row edit-row" data-edit-expense="${item.id}" aria-label="編輯 ${esc(item.title)}">${icon("edit")}</button>
        <button class="delete-row" data-delete="expenses" data-id="${item.id}" aria-label="刪除 ${esc(item.title)}">${icon("trash")}</button>
      </span>
    </div>`;
  }).join("") : emptyState(`${filterScopeLabel()}尚未有開支`, "⌁");
  return `${header("本月共同開支", monthLabel(month), "wallet", "", `<button class="more-button settings-trigger" aria-label="預算設定">${icon("more")}</button>`)}
    <div class="spending-summary">
      <div class="donut"><div class="donut-label"><small>${monthLabel(month)}已用</small><strong>${Math.round(monthTotal / budget * 100)}%</strong></div></div>
      <div class="budget-meta"><p>${monthLabel(month)}總開支</p><strong>${money(monthTotal)}</strong><span class="remaining">${remaining >= 0 ? `預算還有 ${money(remaining)}` : `超出預算 ${money(Math.abs(remaining))}`}</span></div>
      ${filter.is_active ? `<div class="filtered-total"><small>篩選總開支</small><strong>${money(filteredTotal)}</strong><span>${esc(filterScopeLabel())} · ${count} 筆</span></div>` : ""}
    </div>
    <div class="expense-panel">
      <div class="expense-panel-title"><strong>${filter.is_active ? "篩選結果" : "開支紀錄"} · ${count} 筆</strong><button data-open-modal="expense">＋ 新增</button></div>
      <div class="expense-list">${rows}</div>
    </div>`;
}

function renderBalance() {
  const { couple_names: names, split } = state.data.settings;
  const percentages = split?.percentages || [50, 50];
  const totals = Object.fromEntries(names.map((name) => [name, 0]));
  state.data.expenses.forEach((item) => { if (item.paid_by in totals) totals[item.paid_by] += item.amount; });
  const individuallyPaid = totals[names[0]] + totals[names[1]];
  const firstTarget = individuallyPaid * percentages[0] / 100;
  const difference = totals[names[0]] - firstTarget;
  let note = `${filterPeriodLabel()}毋須互相補回差額`;
  if (Math.abs(difference) >= 1) note = `${difference > 0 ? names[1] : names[0]} 需支付給 ${difference > 0 ? names[0] : names[1]}`;
  const methodLabel = ({ equal: "平均分帳", custom: "自訂比例", income: "按收入比例" })[split?.method] || "平均分帳";
  return `${header("彼此分帳", `${methodLabel} · ${formatPercent(percentages[0])} / ${formatPercent(percentages[1])}`, "spark", "", `<button class="more-button" data-open-modal="split" aria-label="調整分帳比例">${icon("edit")}</button>`)}
    <div class="balance-number"><p>${esc(note)}</p><strong>${money(Math.abs(difference))}</strong></div>
    <div class="balance-visual" aria-hidden="true"><span class="leaf one"></span><span class="leaf two"></span><span class="leaf three"></span><span class="plant-pot"></span></div>
    <div class="balance-split"><span>${esc(names[0])} · ${formatPercent(percentages[0])}<strong>已付 ${money(totals[names[0]])}</strong></span><span>${esc(names[1])} · ${formatPercent(percentages[1])}<strong>已付 ${money(totals[names[1]])}</strong></span></div>`;
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString("zh-HK", { maximumFractionDigits: 1 })}%`;
}

function renderShopping() {
  const items = state.data.shopping;
  const openCount = items.filter((item) => !item.purchased).length;
  const completedCount = items.length - openCount;
  const content = items.length ? items.slice(0, 6).map((item) => `<div class="check-row ${item.purchased ? "done" : ""}">
      ${item.purchased
        ? `<button class="round-check checked" disabled aria-label="已完成及入帳">${icon("check")}</button>`
        : `<button class="round-check" data-complete-shopping="${item.id}" aria-label="完成購物並輸入價格"></button>`}
      <span class="list-main"><strong>${esc(item.name)}${item.quantity > 1 ? ` × ${item.quantity}` : ""}</strong><small>${categories[item.category]?.label || "其他"}${item.purchased ? " · 已記入開支" : ""}</small></span>
      <span class="expense-actions">
        <button class="delete-row edit-row" data-edit-shopping="${item.id}" aria-label="編輯 ${esc(item.name)}">${icon("edit")}</button>
        <button class="delete-row" data-delete="shopping" data-id="${item.id}" aria-label="刪除 ${esc(item.name)}">${icon("trash")}</button>
      </span>
    </div>`).join("") : emptyState("清單空空的，一起去補貨吧", "◌");
  return `${header("購物清單", `${openCount} 項待購買 · 完成項目保留 30 日`, "cart", "green", `<button class="more-button" data-open-modal="shopping" aria-label="新增購物項目">${icon("plus")}</button>`)}
    <div class="check-list">${content}</div>
    <div class="shopping-footer-actions">
      <button class="widget-add-button" data-open-modal="shopping">${icon("plus")} 新增購物項目</button>
      ${completedCount ? `<button class="clear-completed-button" data-clear-shopping>${icon("trash")} 清理已完成 (${completedCount})</button>` : ""}
    </div>`;
}

function renderTodo() {
  const items = state.data.todos;
  const openCount = items.filter((item) => !item.done).length;
  const content = items.length ? items.slice(0, 6).map((item) => `<div class="check-row ${item.done ? "done" : ""}">
      <button class="round-check ${item.done ? "checked" : ""}" data-toggle-todo="${item.id}" data-value="${item.done ? 0 : 1}" aria-label="${item.done ? "取消完成" : "完成待辦"}">${item.done ? icon("check") : ""}</button>
      <span class="list-main"><strong>${esc(item.title)}</strong><small><span class="assignee-badge">${esc(item.assignee)}</span> · ${shortDate(item.due_date)}</small></span>
      <button class="delete-row" data-delete="todos" data-id="${item.id}" aria-label="刪除 ${esc(item.title)}">${icon("trash")}</button>
    </div>`).join("") : emptyState("今天沒有待辦，好好休息", "☼");
  return `${header("日常待辦", `${openCount} 件尚未完成`, "check", "purple", `<button class="more-button" data-open-modal="todo" aria-label="新增待辦">${icon("plus")}</button>`)}
    <div class="check-list">${content}</div>
    <button class="widget-add-button" data-open-modal="todo">${icon("plus")} 新增待辦事項</button>`;
}

function nextEventDate(item, today = new Date()) {
  const original = new Date(`${item.event_date}T00:00:00`);
  const now = new Date(today);
  now.setHours(0, 0, 0, 0);
  if (!item.repeats_yearly || original >= now) return original;
  // Rebuild from the original month/day so leap-day rollover never drifts.
  const occurrence = (year) => new Date(year, original.getMonth(), original.getDate());
  let next = occurrence(now.getFullYear());
  if (next < now) next = occurrence(now.getFullYear() + 1);
  return next;
}

function specialDayTimeline(items, today = new Date()) {
  // Compare calendar dates, not elapsed hours (which vary across DST changes).
  const dayNumber = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  return items.map((item) => {
    const next = nextEventDate(item, today);
    return { item, next, days: dayNumber(next) - dayNumber(today) };
  }).sort((a, b) => {
    if ((a.days < 0) !== (b.days < 0)) return a.days < 0 ? 1 : -1;
    return a.days < 0 ? b.days - a.days : a.days - b.days;
  });
}

function specialDayLabel(days) {
  return days < 0 ? `在 ${Math.abs(days)} 天之前` : days === 0 ? "就是今日" : `還有 ${days} 天`;
}

function specialDayReminder(items, today = new Date()) {
  const upcoming = specialDayTimeline(items, today).filter(({ days }) => days >= 0 && days <= 7);
  return {
    count: upcoming.length,
    message: upcoming.length
      ? `今天至未來 7 天有 ${upcoming.length} 個特別日子：${upcoming[0].item.title}，${specialDayLabel(upcoming[0].days)}`
      : "今天至未來 7 天沒有特別日子提醒",
  };
}

function updateSpecialDayNotification() {
  const reminder = specialDayReminder(state.data?.special_days || []);
  const button = $(".notification-button");
  if (button) {
    $(".notice-dot", button).hidden = reminder.count === 0;
    button.setAttribute("aria-label", reminder.message);
    button.title = reminder.message;
  }
  return reminder;
}

let specialDaysRenderedOn = "";

function refreshSpecialDayDates() {
  if (!state.data || specialDaysRenderedOn === localISODate()) return;
  setupTime();
  renderDashboard();
}

function renderMoments() {
  specialDaysRenderedOn = localISODate();
  const items = specialDayTimeline(state.data.special_days);
  const content = items.length ? items.slice(0, 3).map(({ item, next, days }) => {
    return `<div class="event-card">
      <div class="event-date"><strong>${next.getDate()}</strong><small>${next.toLocaleDateString(state.data?.preferences?.locale || "zh-HK", { month: "short" })}</small></div>
      <div class="event-info"><strong>${esc(item.title)}</strong><small>${specialDayLabel(days)} ${item.repeats_yearly ? "· 每年" : ""}</small></div>
      <span class="event-emoji">${esc(item.emoji)}</span>
      <div class="event-actions">
        <button type="button" class="delete-row edit-row" data-edit-special-day="${item.id}" aria-label="編輯 ${esc(item.title)}" title="編輯特別日子">${icon("edit")}</button>
        <button type="button" class="delete-row" data-delete="special-days" data-id="${item.id}" aria-label="刪除 ${esc(item.title)}" title="刪除特別日子">${icon("trash")}</button>
      </div>
    </div>`;
  }).join("") : emptyState("新增一個值得期待的日子", "♡");
  return `${header("特別日子", "所有值得記住的時刻", "calendar", "yellow", `<button class="more-button" data-open-modal="event" aria-label="新增特別日子">${icon("plus")}</button>`)}
    <div class="event-list">${content}</div>
    <button class="widget-add-button" data-open-modal="event">${icon("plus")} 收藏特別日子</button>`;
}

function renderInsight() {
  const { breakdown, expense_total: total, month_expense_total: monthTotal, settings, expenses } = state.data;
  const top = breakdown[0];
  const percentage = top && total ? Math.round(top.amount / total * 100) : 0;
  const message = top ? `${filterPeriodLabel()}的「${top.label}」佔了 ${percentage}%` : `${filterScopeLabel()}尚未有消費紀錄`;
  const buckets = expenseBuckets(expenses, state.data.filter);
  const max = Math.max(...buckets.map((bucket) => bucket.total), 1);
  const bars = buckets.map((bucket) => `<div class="bar" title="${esc(bucket.label)}：${money(bucket.total)}"><span style="height:${bucket.total ? Math.max(5, bucket.total / max * 100) : 0}%"></span><small>${esc(bucket.label)}</small></div>`).join("");
  const used = Math.round(monthTotal / settings.monthly_budget * 100);
  return `${header("生活小洞察", "讓日常更有方向", "spark", "purple")}
    <div class="insight-hero"><span class="insight-orb">${icon("spark")}</span><div class="insight-copy"><p>${esc(filterScopeLabel())}</p><strong>${esc(message)}</strong></div></div>
    <div class="expense-panel-title"><strong>開支走勢</strong><span class="widget-subtitle">${monthLabel(state.month)}預算已用 ${used}%</span></div>
    <div class="bars">${bars}</div>`;
}

function expenseBuckets(expenses, filter) {
  const dayMs = 86400000;
  const start = Date.parse(`${filter.date_from}T00:00:00Z`);
  const end = Date.parse(`${filter.date_to}T00:00:00Z`);
  const dayCount = Math.max(1, Math.round((end - start) / dayMs) + 1);
  const bucketCount = Math.min(7, dayCount);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const offset = Math.floor(index * dayCount / bucketCount);
    const date = new Date(start + offset * dayMs);
    return { total: 0, label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}` };
  });
  expenses.forEach((item) => {
    const offset = Math.max(0, Math.round((Date.parse(`${item.spent_on}T00:00:00Z`) - start) / dayMs));
    const index = Math.min(bucketCount - 1, Math.floor(offset * bucketCount / dayCount));
    buckets[index].total += Number(item.amount);
  });
  return buckets;
}

function emptyState(message, symbol) {
  return `<div class="empty-state"><span>${symbol}</span><p>${message}</p></div>`;
}

function renderLoadError(message) {
  $("#dashboard-grid").innerHTML = `<article class="widget size-wide"><div class="empty-state"><span>!</span><p>${esc(message)}</p><button class="button primary" id="retry-load">重新載入</button></div></article>`;
}

const forms = {
  expense: {
    title: "記一筆共同開支",
    endpoint: "/api/expenses",
    success: "開支已經記下來了",
    edit: { title: "編輯共同開支", endpoint: (item) => `/api/expenses/${item.id}`, method: "PATCH", success: "開支資料已更新", submitLabel: "儲存變更" },
    fields: ({ item = {} } = {}) => [
      { name: "title", label: "這筆開支是甚麼？", value: item.title || "", placeholder: "例如：週末超市購物", full: true, required: true, autofocus: true },
      { name: "amount", label: "金額", type: "number", value: item.amount ?? "", placeholder: "0", min: "0.01", step: "0.01", required: true },
      { name: "category", label: "分類", type: "select", options: categoryOptions(), value: item.category || "groceries" },
      { name: "paid_by", label: "由誰先付款？", type: "select", options: [...state.data.settings.couple_names, "共同"].map((name) => [name, name]), value: item.paid_by || "共同" },
      { name: "spent_on", label: "日期", type: "date", value: item.spent_on || localISODate(), required: true },
    ],
  },
  shopping: {
    title: "加入購物清單",
    endpoint: "/api/shopping",
    success: "已放進共同購物清單",
    note: "毋須預先輸入價格，完成購買時才會要求輸入實付金額。",
    edit: { title: "編輯購物項目", endpoint: (item) => `/api/shopping/${item.id}`, method: "PATCH", success: "購物項目已更新", submitLabel: "儲存變更", note: "修改已完成項目不會影響早前記錄的開支。" },
    fields: ({ item = {} } = {}) => [
      { name: "name", label: "要買甚麼？", value: item.name || "", placeholder: "例如：燕麥奶", full: true, required: true, autofocus: true },
      { name: "quantity", label: "數量", type: "number", value: item.quantity || 1, min: "1", step: "1", required: true },
      { name: "category", label: "分類", type: "select", options: categoryOptions(), value: item.category || "groceries" },
    ],
  },
  shoppingComplete: {
    title: "完成購物並入帳",
    endpoint: (item) => `/api/shopping/${item.id}/complete`,
    method: "POST",
    success: "購物已完成，實付金額亦已記入開支",
    submitLabel: "完成並記入開支",
    note: "請輸入今次購物的實付總額。入帳後，購物項目與開支會各自獨立保存。",
    fields: ({ item }) => [
      { name: "actual_price", label: `${item.name} 實付總額（HK$）`, type: "number", placeholder: "0.00", min: "0.01", step: "0.01", required: true, full: true, autofocus: true },
      { name: "paid_by", label: "由誰付款？", type: "select", options: [...state.data.settings.couple_names, "共同"].map((name) => [name, name]), value: "共同" },
      { name: "spent_on", label: "購買日期", type: "date", value: localISODate(), required: true },
    ],
  },
  todo: {
    title: "新增日常待辦",
    endpoint: "/api/todos",
    success: "待辦已經排好了",
    fields: () => [
      { name: "title", label: "要完成甚麼？", placeholder: "例如：整理露台植物", full: true, required: true, autofocus: true },
      { name: "assignee", label: "由誰負責？", type: "select", options: [...state.data.settings.couple_names, "一起"].map((name) => [name, name]), value: "一起" },
      { name: "due_date", label: "期限", type: "date", value: localISODate(2) },
    ],
  },
  event: {
    title: "收藏特別日子",
    endpoint: "/api/special-days",
    success: "重要的日子已收藏",
    fields: () => [
      { name: "title", label: "這是甚麼日子？", placeholder: "例如：我們的紀念日", full: true, required: true, autofocus: true },
      { name: "event_date", label: "日期", type: "date", value: localISODate(30), required: true },
      { name: "emoji", label: "小記號", value: "♥", maxlength: "8" },
      { name: "repeats_yearly", label: "每年提醒", type: "select", options: [["true", "每年提醒"], ["false", "只提醒一次"]], value: "true", full: true },
    ],
    transform: (data) => ({ ...data, repeats_yearly: data.repeats_yearly === "true" }),
  },
  split: {
    title: "分帳計算機",
    endpoint: "/api/settings",
    method: "PATCH",
    success: "分帳方式已更新",
    fields: () => {
      const names = state.data.settings.couple_names;
      const split = state.data.settings.split || { method: "equal", percentages: [50, 50], incomes: [0, 0] };
      return [
        { name: "split_method", label: "分帳方式", type: "select", options: [["equal", "平均分帳 50 / 50"], ["custom", "自訂百分比"], ["income", "按收入比例計算"]], value: split.method, full: true },
        { name: "percentage", label: `${names[0]} 負責的百分比`, type: "number", value: split.percentages[0], min: "0", max: "100", step: "0.1", full: true, group: "custom" },
        { name: "income_one", label: `${names[0]} 每月收入（HK$）`, type: "number", value: split.incomes?.[0] || 0, min: "0", step: "1", group: "income" },
        { name: "income_two", label: `${names[1]} 每月收入（HK$）`, type: "number", value: split.incomes?.[1] || 0, min: "0", step: "1", group: "income" },
      ];
    },
    extra: () => {
      const names = state.data.settings.couple_names;
      return `<div class="split-preview" id="split-preview">
        <p>預計分帳比例</p>
        <div><span><small>${esc(names[0])}</small><strong id="split-first-percent">50%</strong></span><i></i><span><small>${esc(names[1])}</small><strong id="split-second-percent">50%</strong></span></div>
        <small id="split-help">雙方平均分擔共同開支</small>
      </div>`;
    },
    transform: (data) => {
      if (data.split_method === "custom") return { split: { method: "custom", percentage: Number(data.percentage) } };
      if (data.split_method === "income") return { split: { method: "income", incomes: [Number(data.income_one), Number(data.income_two)] } };
      return { split: { method: "equal" } };
    },
  },
  settings: {
    title: "我們的設定",
    endpoint: "/api/settings",
    method: "PATCH",
    success: "設定已更新",
    fields: () => [
      { name: "monthly_budget", label: "每月共同預算", type: "number", value: state.data.settings.monthly_budget, min: "1", required: true, full: true },
      { name: "partner_one", label: "你的名字", value: state.data.settings.couple_names[0], required: true },
      { name: "partner_two", label: "另一半的名字", value: state.data.settings.couple_names[1], required: true },
      { name: "started_on", label: "我們開始的日期", type: "date", value: state.data.settings.started_on, required: true, full: true, max: localISODate() },
    ],
    transform: (data) => ({ monthly_budget: Number(data.monthly_budget), couple_names: [data.partner_one, data.partner_two], started_on: data.started_on }),
  },
  categoryCreate: {
    title: "新增記帳分類",
    endpoint: "/api/categories",
    success: "已成功新增分類",
    fields: () => [
      { name: "key", label: "分類代碼（英文小寫與數字，如 pet）", placeholder: "例如：pet, travel", full: true, required: true, autofocus: true },
      { name: "label", label: "分類名稱（如 毛孩日常、旅遊度假）", placeholder: "例如：毛孩日常", full: true, required: true },
      { name: "color", label: "代表顏色", type: "color", value: "#ed765f" },
      {
        name: "icon",
        label: "圖示標籤",
        type: "select",
        options: [
          ["tag", "標籤 🏷️"],
          ["spark", "閃光 ✨"],
          ["cart", "購物車 🛒"],
          ["wallet", "錢包 👛"],
          ["utensils", "餐具 🍽️"],
          ["home", "居家 🏡"],
          ["train", "交通 🚆"],
          ["bolt", "水電 ⚡"],
          ["check", "勾選 ✔️"],
          ["calendar", "日曆 📅"],
          ["bell", "鈴鐺 🔔"],
          ["gift", "禮物 🎁"],
          ["dots", "更多 ⋯"],
        ],
        value: "tag",
      },
    ],
  },
  categoryDelete: {
    title: "移轉並移除分類",
    endpoint: (item) => `/api/categories/${encodeURIComponent(item.key)}`,
    method: "DELETE",
    success: "分類已從資料庫移除，相關項目已移轉",
    submitLabel: "確認移轉並移除",
    fields: ({ item, targets }) => [{
      name: "target_category", label: "移轉至分類", type: "select", full: true,
      required: true, autofocus: true,
      options: [["", "請選擇目標分類"], ...targets.filter((c) => c.key !== item.key).map((c) => [c.key, c.label])],
    }],
    extra: ({ item }) => `<p class="form-note">將「${esc(item.label)}」的 ${item.expense_count} 筆開支及 ${item.shopping_count} 項購物（包括已完成項目）移至所選分類，再永久刪除原分類的資料庫記錄。項目內容及單據會保留。</p>`,
  },
  categoryEdit: {
    title: "編輯記帳分類",
    endpoint: (item) => `/api/categories/${encodeURIComponent(item.key)}`,
    method: "PATCH",
    success: "分類資料已更新",
    submitLabel: "儲存變更",
    fields: ({ item = {} } = {}) => [
      { name: "key", label: "分類代碼 (不可修改)", value: item.key, full: true, disabled: true },
      { name: "label", label: "分類名稱", value: item.label || "", full: true, required: true, autofocus: true },
      { name: "color", label: "代表顏色", type: "color", value: item.color || "#a8a59e" },
      {
        name: "icon",
        label: "圖示標籤",
        type: "select",
        options: [
          ["tag", "標籤 🏷️"],
          ["spark", "閃光 ✨"],
          ["cart", "購物車 🛒"],
          ["wallet", "錢包 👛"],
          ["utensils", "餐具 🍽️"],
          ["home", "居家 🏡"],
          ["train", "交通 🚆"],
          ["bolt", "水電 ⚡"],
          ["check", "勾選 ✔️"],
          ["calendar", "日曆 📅"],
          ["bell", "鈴鐺 🔔"],
          ["gift", "禮物 🎁"],
          ["dots", "更多 ⋯"],
        ],
        value: item.icon || "tag",
      },
    ],
  },
  adminSettingCreate: {
    title: "新增系統參數",
    endpoint: "/api/admin/settings",
    success: "系統參數已新增",
    fields: () => [
      { name: "key", label: "參數名稱 Key", placeholder: "例如：custom_note_prefix", full: true, required: true, autofocus: true },
      { name: "value", label: "參數數值 Value（文字、數字或有效 JSON）", placeholder: "例如：100 或 true 或 \"字串\"", full: true, required: true },
    ],
    transform: (data) => {
      let parsed = data.value;
      try { parsed = JSON.parse(data.value); } catch (_) {}
      return { key: data.key, value: parsed };
    },
  },
  adminSettingEdit: {
    title: "編輯系統參數",
    endpoint: (item) => `/api/admin/settings/${encodeURIComponent(item.key)}`,
    method: "PATCH",
    success: "系統參數已更新",
    submitLabel: "儲存變更",
    fields: ({ item = {} } = {}) => [
      { name: "key", label: "參數名稱 (不可修改)", value: item.key, full: true, disabled: true },
      { name: "value", label: "參數數值 Value（支援文字、數字或 JSON）", value: typeof item.parsed_value === "object" ? JSON.stringify(item.parsed_value) : (item.value ?? ""), full: true, required: true, autofocus: true },
    ],
    transform: (data) => {
      let parsed = data.value;
      try { parsed = JSON.parse(data.value); } catch (_) {}
      return { value: parsed };
    },
  },
  todoEdit: {
    title: "編輯日常待辦",
    endpoint: (item) => `/api/todos/${item.id}`,
    method: "PATCH",
    success: "待辦已更新",
    submitLabel: "儲存變更",
    fields: ({ item = {} } = {}) => [
      { name: "title", label: "要完成甚麼？", value: item.title || "", full: true, required: true, autofocus: true },
      { name: "assignee", label: "由誰負責？", type: "select", options: [...state.data.settings.couple_names, "一起"].map((name) => [name, name]), value: item.assignee || "一起" },
      { name: "due_date", label: "期限", type: "date", value: item.due_date || "" },
    ],
  },
  specialDayEdit: {
    title: "編輯特別日子",
    endpoint: (item) => `/api/special-days/${item.id}`,
    method: "PATCH",
    success: "特別日子已更新",
    submitLabel: "儲存變更",
    fields: ({ item = {} } = {}) => [
      { name: "title", label: "這是甚麼日子？", value: item.title || "", full: true, required: true, autofocus: true },
      { name: "event_date", label: "日期", type: "date", value: item.event_date, required: true },
      { name: "emoji", label: "小記號", value: item.emoji || "♥", maxlength: "8" },
      { name: "repeats_yearly", label: "每年提醒", type: "select", options: [["true", "每年提醒"], ["false", "只提醒一次"]], value: String(Boolean(item.repeats_yearly)), full: true },
    ],
    transform: (data) => ({ ...data, repeats_yearly: data.repeats_yearly === "true" }),
  },
};

function categoryOptions() {
  return Object.entries(categories).map(([value, meta]) => [value, meta.label]);
}

function localISODate(addDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + addDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function openModal(type, context = {}) {
  if (!state.data || state.submitting) return;
  if (type === "orderImport") return openOrderImport();
  cancelOrderImport();
  const config = forms[type];
  if (!config) return;
  cancelInvoiceOCR();
  invoiceImage = null;
  const variant = context.item && config.edit ? config.edit : {};
  const effective = { ...config, ...variant };
  $("#modal-title").textContent = effective.title;
  const fields = config.fields(context).map(renderField).join("");
  const extra = (typeof effective.extra === "function" ? effective.extra(context) : (effective.extra || ""))
    + (type === "expense" && context.item?.has_invoice ? `<a class="form-note" href="/api/expenses/${context.item.id}/invoice" target="_blank" rel="noopener">查看已保存單據</a>` : "");
  $("#dynamic-form").innerHTML = `${type === "expense" && !context.item ? invoiceControls() : ""}${fields}${extra}${effective.note ? `<p class="form-note">${effective.note}</p>` : ""}
    <p id="form-save-status" class="form-note" role="alert" hidden></p>
    <div class="form-actions"><button type="button" class="button secondary" id="cancel-modal">稍後再算</button><button type="submit" class="button primary">${effective.submitLabel || "儲存到 Teletubbyland"}</button></div>`;
  $("#dynamic-form").dataset.formType = type;
  $("#dynamic-form").dataset.endpoint = typeof effective.endpoint === "function" ? effective.endpoint(context.item) : effective.endpoint;
  $("#dynamic-form").dataset.method = effective.method || "POST";
  $("#dynamic-form").dataset.success = effective.success;
  $("#modal-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  if (type === "split") updateSplitCalculator();
  setTimeout(() => $("#dynamic-form [autofocus]")?.focus(), 120);
}

let orderImport = null;

function cancelOrderImport() {
  orderImport?.request?.abort();
  orderImport = null;
  $("#modal-backdrop .modal")?.classList.remove("order-import-modal");
}

function openOrderImport() {
  cancelInvoiceOCR();
  cancelOrderImport();
  invoiceImage = null;
  orderImport = { images: [], orders: [], request: null, token: null, pending: null };
  const form = $("#dynamic-form");
  form.dataset.formType = "orderImport";
  $("#modal-title").textContent = "淘寶／拼多多截圖記賬";
  $("#modal-backdrop .modal").classList.add("order-import-modal");
  form.innerHTML = `<section class="order-import full">
    <p class="form-note">一次上傳 1–10 張訂單頁面，每張可包含多筆訂單。截圖會傳送至 AI 服務，確認前不會記帳。沒有購物日期的項目會留空。</p>
    <label class="button secondary invoice-file">選擇多張訂單截圖<input id="order-files" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" aria-label="上傳淘寶或拼多多訂單截圖"></label>
    <p id="order-status" role="status" aria-live="polite">請選擇清晰、包含實付金額的訂單截圖。</p>
    <div id="order-previews" class="order-previews"></div>
    <ul id="order-warnings" class="order-warnings" hidden></ul>
    <section id="order-review" hidden>
      <div class="order-bulk">
        <label>購物日期<input id="order-bulk-date" type="date"></label>
        <button class="button secondary" type="button" id="order-date-all">套用至全部</button>
        <button class="button secondary" type="button" id="order-date-selected">套用至勾選項目</button>
      </div>
      <div class="order-bulk">
        <label>人民幣換港幣匯率<input id="order-rate" type="number" min="0.000001" step="any" placeholder="1 CNY = ? HKD"></label>
        <button class="button secondary" type="button" id="order-convert">換算勾選項目</button>
      </div>
      <p class="form-note">匯率由你提供，換算會覆蓋勾選項目的港幣金額，請按實際扣款核對。未付款及已全額退款的訂單不應記入開支。</p>
      <label>此批付款人<select id="order-payer" required><option value="">請選擇付款人</option>${[...state.data.settings.couple_names, "共同"].map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}</select></label>
      <div class="order-selection"><label class="invoice-confirm"><input id="order-select-all" type="checkbox" checked><span>全選（用於批量日期／換算）</span></label><strong id="order-count"></strong></div>
      <p class="form-note">所有保留項目都會入賬；不需要的項目請按「移除」。每筆會保存首張來源截圖供日後查看。</p>
      <div id="order-rows"></div>
      <div id="invoice-duplicates" class="invoice-duplicates" role="alert" hidden></div>
      <label class="invoice-confirm"><input id="order-confirm" type="checkbox" required><span>已核對每筆訂單、重複項目、購物日期及港幣實付金額</span></label>
    </section>
    <p id="form-save-status" class="form-note" role="alert" hidden></p>
    <div class="form-actions"><button type="button" class="button secondary" id="cancel-modal">取消</button><button type="submit" class="button primary" id="order-save" disabled>確認並批量記帳</button></div>
  </section>`;
  $("#order-files", form).addEventListener("change", event => {
    const files = [...event.target.files];
    event.target.value = "";
    if (files.length) recognizeOrders(files);
  });
  $("#order-date-all", form).addEventListener("click", () => applyOrderDate(false));
  $("#order-date-selected", form).addEventListener("click", () => applyOrderDate(true));
  $("#order-convert", form).addEventListener("click", convertOrderAmounts);
  $("#order-select-all", form).addEventListener("change", event => {
    orderImport.orders.forEach(row => { row.selected = event.target.checked; });
    renderOrderRows();
  });
  $("#order-rows", form).addEventListener("input", event => {
    const row = orderImport?.orders[Number(event.target.closest("[data-order-row]")?.dataset.orderRow)];
    const field = event.target.dataset.orderField;
    if (!row || !field) return;
    row[field] = field === "selected" ? event.target.checked : event.target.value;
    $("#order-confirm").checked = false;
    if (field === "selected") updateOrderSelection();
  });
  $("#order-rows", form).addEventListener("click", event => {
    const button = event.target.closest("[data-remove-order]");
    if (!button || state.submitting || orderImport?.request) return;
    orderImport.orders.splice(Number(button.dataset.removeOrder), 1);
    renderOrderRows();
  });
  $("#modal-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
}

function updateOrderSelection() {
  const rows = orderImport.orders;
  const selected = rows.filter(row => row.selected).length;
  $("#order-count").textContent = `${rows.length} 筆待記帳 · 勾選 ${selected} 筆`;
  const checkbox = $("#order-select-all");
  checkbox.checked = rows.length > 0 && selected === rows.length;
  checkbox.indeterminate = selected > 0 && selected < rows.length;
}

function renderOrderRows() {
  const rows = orderImport.orders;
  $("#order-rows").innerHTML = rows.map((row, index) => `<article class="order-row" data-order-row="${index}">
    <header><label class="invoice-confirm"><input type="checkbox" data-order-field="selected" ${row.selected ? "checked" : ""}><span>第 ${index + 1} 筆 · 來源第 ${row.source_pages.join("、")} 張</span></label><button type="button" class="button secondary" data-remove-order="${index}">移除</button></header>
    <div class="order-fields">
      <label>平台<select data-order-field="platform">${["淘寶", "拼多多"].map(p => `<option ${row.platform === p ? "selected" : ""}>${p}</option>`).join("")}</select></label>
      <label>訂單編號（如有）<input data-order-field="order_id" maxlength="100" value="${esc(row.order_id || "")}"></label>
      <label class="full">開支名稱<input data-order-field="title" required maxlength="100" value="${esc(row.title)}"></label>
      <label>原幣實付金額<input data-order-field="original_amount" type="number" min="0.01" max="100000000" step="0.01" value="${esc(row.original_amount ?? "")}"></label>
      <label>原幣幣別<select data-order-field="currency">${[["", "未能確認"], ["CNY", "人民幣 CNY"], ["HKD", "港幣 HKD"], ...(![null, "", "CNY", "HKD"].includes(row.currency) ? [[row.currency, row.currency]] : [])].map(([value, label]) => `<option value="${esc(value)}" ${value === (row.currency || "") ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      <label>入賬港幣金額<input data-order-field="amount" type="number" required min="0.01" max="100000000" step="0.01" value="${esc(row.amount ?? "")}" placeholder="實際扣款港幣"></label>
      <label>購物日期${row.spent_on ? "" : " · 待補填"}<input data-order-field="spent_on" type="date" required value="${esc(row.spent_on || "")}"></label>
      <label class="full">分類<select data-order-field="category">${categoryOptions().map(([key, label]) => `<option value="${esc(key)}" ${row.category === key ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
    </div>
    ${row.warnings.length ? `<ul class="order-warnings">${row.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
  </article>`).join("");
  $("#order-save").disabled = !rows.length;
  $("#order-confirm").checked = false;
  updateOrderSelection();
}

function applyOrderDate(selectedOnly) {
  if (!orderImport || orderImport.request || state.submitting) return;
  const date = $("#order-bulk-date").value;
  if (!date) return toast("請先選擇購物日期", true);
  let count = 0;
  orderImport.orders.forEach(row => {
    if (!selectedOnly || row.selected) { row.spent_on = date; count += 1; }
  });
  renderOrderRows();
  toast(count ? `已為 ${count} 筆訂單填寫日期` : "請先勾選項目", !count);
}

function convertOrderAmounts() {
  if (!orderImport || orderImport.request || state.submitting) return;
  const rate = Number($("#order-rate").value);
  if (!Number.isFinite(rate) || rate <= 0) return toast("請填寫有效匯率", true);
  let count = 0;
  orderImport.orders.forEach(row => {
    const original = Number(row.original_amount);
    const amount = Math.round((original * rate + Number.EPSILON) * 100) / 100;
    if (row.selected && row.currency === "CNY" && original > 0 && Number.isFinite(amount) && amount > 0 && amount <= 100000000) {
      row.amount = amount;
      count += 1;
    }
  });
  renderOrderRows();
  toast(count ? `已換算 ${count} 筆人民幣訂單，請核對實際扣款` : "沒有可換算的已勾選人民幣訂單", !count);
}

async function recognizeOrders(files) {
  const session = orderImport;
  if (!session || session.request || state.submitting || session.pending) return;
  if (files.length > 10) return toast("每批最多 10 張截圖", true);
  const form = $("#dynamic-form");
  const request = new AbortController();
  session.request = request;
  const controls = $$("input, select, button", form).filter(el => el.id !== "cancel-modal");
  const disabled = controls.map(el => el.disabled);
  controls.forEach(el => { el.disabled = true; });
  const status = $("#order-status");
  let succeeded = false;
  try {
    const images = [], stored = [];
    for (const [index, file] of files.entries()) {
      status.textContent = `正在處理第 ${index + 1}／${files.length} 張截圖…`;
      images.push(await prepareInvoiceImage(file, { maxEdge: 3000, maxBytes: 1_000_000 }));
      if (orderImport !== session) return;
      stored.push(await prepareInvoiceImage(file, { maxEdge: 2000, quality: 0.8, maxBytes: 600_000 }));
      if (orderImport !== session) return;
    }
    status.textContent = `正在識別 ${images.length} 張訂單截圖，請稍候…`;
    const result = await api("/api/expenses/orders/ocr", { method: "POST", body: JSON.stringify({ images }), signal: request.signal, timeoutMs: 165_000 });
    if (orderImport !== session) return;
    if (!Array.isArray(result.orders)) throw new Error("識別結果不完整，請重試");
    session.images = stored;
    session.orders = result.orders.map(row => ({ ...row, selected: true }));
    // Cryptographic UUID is unavailable on some HTTP LAN deployments.
    session.token = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("");
    $("#order-previews").innerHTML = images.map((src, i) => `<details><summary>查看第 ${i + 1} 張截圖</summary><img src="${src}" alt="第 ${i + 1} 張訂單截圖"></details>`).join("");
    $("#order-warnings").innerHTML = (result.warnings || []).map(w => `<li>${esc(w)}</li>`).join("");
    $("#order-warnings").hidden = !(result.warnings || []).length;
    $("#order-review").hidden = !session.orders.length;
    $("#invoice-duplicates").hidden = true;
    $("#invoice-duplicates").innerHTML = "";
    $("#form-save-status").hidden = true;
    succeeded = true;
    status.textContent = session.orders.length ? `已識別 ${session.orders.length} 筆，請核對；新選截圖會替換本批草稿。` : "未找到可記帳的已付款訂單，請查看提示或更換截圖。";
  } catch (error) {
    if (orderImport === session) status.textContent = error.message + (session.orders.length ? "；原有核對清單已保留。" : "");
  } finally {
    if (orderImport === session) {
      session.request = null;
      controls.forEach((el, i) => { el.disabled = disabled[i]; });
      if (succeeded) renderOrderRows();
      $("#order-payer").disabled = !session.orders.length;
      $("#order-confirm").disabled = !session.orders.length;
    }
  }
}

function orderImportPayload(session, payer) {
  return {
    token: session.token, confirmed: true, images: session.images,
    orders: session.orders.map(row => ({
      platform: row.platform, order_id: row.order_id || null,
      title: row.title.startsWith(row.platform) ? row.title : `${row.platform}－${row.title}`,
      amount: Number(row.amount), original_amount: row.original_amount === "" || row.original_amount == null ? null : Number(row.original_amount),
      currency: row.currency || null, spent_on: row.spent_on, category: row.category,
      paid_by: payer, source_page: row.source_pages[0],
    })),
  };
}

async function submitOrderImport(form) {
  const session = orderImport;
  if (!session || session.request || state.submitting || !session.orders.length) return;
  if (!form.reportValidity()) return;
  const duplicateConfirm = $("#invoice-duplicate-confirm", form);
  if (duplicateConfirm && !duplicateConfirm.checked) return;
  const payload = session.pending || orderImportPayload(session, $("#order-payer").value);
  if (duplicateConfirm?.checked) payload.reviewed_invoice_ids = JSON.parse($("#invoice-duplicates").dataset.reviewIds);
  const controls = $$("input, select, button", form);
  state.submitting = true;
  controls.forEach(el => { el.disabled = true; });
  const status = $("#form-save-status");
  const button = $("#order-save");
  status.hidden = true;
  button.textContent = "正在批量儲存…";
  let saved = false;
  try {
    const result = await api("/api/expenses/orders/import", { method: "POST", body: JSON.stringify(payload), timeoutMs: 60_000 });
    if (result?.ok !== true || !Array.isArray(result.ids) || result.ids.length !== payload.orders.length) throw new Error("伺服器未確認儲存結果");
    saved = true;
    revealSavedExpense(payload.orders[0]);
    closeModal({ saved: true });
    toast(`已記帳 ${result.ids.length} 筆，按各自購物日期歸入相應月份`);
    await loadDashboard({ quiet: true, throwOnError: true });
  } catch (error) {
    if (saved) {
      renderLoadError("訂單已儲存，但清單載入失敗。請重新載入，毋須再次提交。");
    } else {
      // Freeze the exact submission after uncertain transport errors; retries use the same token and body.
      session.pending = !error.status || error.status >= 500 ? payload : null;
      if (error.code === "duplicate_invoice") showInvoiceDuplicates(error.duplicates, form);
      status.textContent = error.message + (session.pending ? "。請按「重試原批次」確認儲存結果，不會重複入賬。" : "。本次沒有新增記錄，請核對後再試。");
      status.hidden = false;
    }
  } finally {
    state.submitting = false;
    if (!saved && orderImport === session) {
      controls.forEach((el, i) => { el.disabled = session.pending ? !["order-save", "cancel-modal"].includes(el.id) : false; });
      button.textContent = session.pending ? "重試原批次" : "確認並批量記帳";
    }
  }
}

let invoiceRequest = null;
let invoiceImage = null;

function cancelInvoiceOCR() {
  invoiceRequest?.abort();
  invoiceRequest = null;
}

function invoiceControls() {
  return `<section class="invoice-scan" aria-label="單據識別">
    <div class="invoice-buttons">
      <button type="button" class="button secondary" data-open-modal="orderImport">淘寶／拼多多多頁截圖</button>
      <label class="button secondary invoice-file">${icon("plus")} 拍攝單據<input type="file" accept="image/*" capture="environment" data-invoice-file aria-label="拍攝單據"></label>
      <label class="button secondary invoice-file">${icon("plus")} 上傳單據<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-invoice-file aria-label="上傳單據"></label>
    </div>
    <p class="form-note">照片將傳送至 AI 服務進行識別。可補記上月或往年單據，開支會按核對後的日期記入相應年月。</p>
    <p id="invoice-status" role="status" aria-live="polite"></p>
    <img id="invoice-preview" alt="待核對的單據" hidden>
    <ul id="invoice-warnings" hidden></ul>
    <div id="invoice-duplicates" class="invoice-duplicates" role="alert" hidden></div>
    <label class="invoice-confirm" hidden><input type="checkbox" id="invoice-confirm"><span>已核對單據日期（包括年份）及港幣金額</span></label>
  </section>`;
}

function showInvoiceDuplicates(duplicates, form) {
  const panel = $("#invoice-duplicates", form);
  panel.hidden = !duplicates.length;
  panel.innerHTML = duplicates.length ? `
    <strong>這張單據可能已經上傳過了</strong>
    <p>請打開已有單據圖片，與本次照片比較。若是同一張，請取消記帳。</p>
    <ul>${duplicates.map((item) => `<li><a href="/api/expenses/${Number(item.id)}/invoice" target="_blank" rel="noopener">查看單據圖片：${esc(item.title)}</a><br>${esc(item.spent_on)} · HK$${Number(item.amount).toFixed(2)} · ${esc(item.reason)}</li>`).join("")}</ul>
    <label class="invoice-confirm"><input type="checkbox" id="invoice-duplicate-confirm" required><span>已查看圖片，確認本次是另一張單據，仍要記帳</span></label>` : "";
  panel.dataset.reviewIds = JSON.stringify(duplicates.map((item) => item.id));
}

async function prepareInvoiceImage(file, { maxEdge = 2400, quality = 0.88, maxBytes = 4_000_000 } = {}) {
  if (file.size > 20_000_000) throw new Error("照片不能超過 20 MB");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => { throw new Error("無法讀取照片，請改用 JPEG、PNG 或 WebP"); });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", quality);
      const bytes = Math.ceil((image.length - image.indexOf(",") - 1) * 3 / 4);
      if (bytes <= maxBytes) return image;
      // Reduce quality first, then dimensions, always drawing from the source image.
      if (quality > 0.55) quality = Math.max(0.55, quality - 0.1);
      else {
        canvas.width = Math.max(1, Math.round(canvas.width * 0.8));
        canvas.height = Math.max(1, Math.round(canvas.height * 0.8));
      }
    }
    throw new Error("照片壓縮後仍過大，請裁剪後重試");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function recognizeInvoice(file) {
  if (state.submitting || invoiceRequest) return;
  const request = new AbortController();
  invoiceRequest = request;
  const form = $("#dynamic-form");
  const status = $("#invoice-status", form);
  const controls = $$("input, select, button[type=submit]", form);
  controls.forEach((control) => { control.disabled = true; });
  status.textContent = "正在識別單據…";
  // Keep the existing draft and preview together until a new recognition succeeds.
  const timeout = setTimeout(() => request.abort(), 100_000);
  try {
    const image = await prepareInvoiceImage(file);
    if (invoiceRequest !== request) return;
    const result = await api("/api/expenses/ocr", {
      method: "POST", body: JSON.stringify({ image }), signal: request.signal, timeoutMs: 100_000,
    });
    if (invoiceRequest !== request) return;
    const storedImage = await prepareInvoiceImage(file, { maxEdge: 1600, quality: 0.75, maxBytes: 600_000 });
    if (invoiceRequest !== request) return;
    Object.entries(result.draft).forEach(([name, value]) => {
      const field = form.elements.namedItem(name);
      if (field) field.value = value ?? "";
    });
    const payer = form.elements.namedItem("paid_by");
    if (!$("option[value='']", payer)) payer.add(new Option("請選擇付款人", ""), 0);
    payer.value = "";
    payer.required = true;
    const preview = $("#invoice-preview", form);
    preview.src = image;
    invoiceImage = storedImage;
    preview.hidden = false;
    const warnings = $("#invoice-warnings", form);
    warnings.replaceChildren(...result.warnings.map((message) => {
      const li = document.createElement("li");
      li.textContent = message;
      return li;
    }));
    warnings.hidden = !result.warnings.length;
    showInvoiceDuplicates(result.duplicates || [], form);
    const confirm = $("#invoice-confirm", form);
    confirm.closest("label").hidden = false;
    confirm.required = true;
    confirm.checked = false;
    status.textContent = "識別完成，待核對";
    $("#modal-title").textContent = "核對單據開支";
    $("button[type=submit]", form).textContent = "確認並記帳";
  } catch (error) {
    if (invoiceRequest === request) status.textContent = error.message;
  } finally {
    clearTimeout(timeout);
    if (invoiceRequest === request) {
      invoiceRequest = null;
      controls.forEach((control) => { control.disabled = false; });
    }
  }
}

function openExpenseEditor(itemId) {
  const item = state.data.expenses.find((expense) => expense.id === Number(itemId));
  if (!item) return toast("找不到要編輯的開支", true);
  openModal("expense", { item });
}

function openSpecialDayEditor(itemId) {
  const item = state.data.special_days.find((day) => day.id === Number(itemId));
  if (!item) return toast("找不到要編輯的特別日子", true);
  openModal("specialDayEdit", { item });
}

function shoppingItem(itemId) {
  return state.data.shopping.find((item) => item.id === Number(itemId));
}

function openShoppingEditor(itemId) {
  const item = shoppingItem(itemId);
  if (!item) return toast("找不到要編輯的購物項目", true);
  openModal("shopping", { item });
}

function openShoppingCompletion(itemId) {
  const item = shoppingItem(itemId);
  if (!item) return toast("找不到購物項目", true);
  openModal("shoppingComplete", { item });
}

function renderField(field) {
  const attrs = ["required", "autofocus", "disabled"].filter((key) => field[key]).join(" ");
  const value = field.value ?? "";
  let control;
  if (field.type === "select") {
    control = `<select name="${field.name}" ${attrs}>${field.options.map(([optionValue, label]) => `<option value="${esc(optionValue)}" ${String(optionValue) === String(value) ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
  } else if (field.type === "textarea") {
    control = `<textarea name="${field.name}" ${attrs} rows="3" placeholder="${esc(field.placeholder || "")}">${esc(value)}</textarea>`;
  } else {
    const properties = ["min", "max", "step", "maxlength"].filter((key) => field[key] !== undefined).map((key) => `${key}="${esc(field[key])}"`).join(" ");
    control = `<input name="${field.name}" type="${field.type || "text"}" value="${esc(value)}" placeholder="${esc(field.placeholder || "")}" ${properties} ${attrs}>`;
  }
  return `<div class="field ${field.full ? "full" : ""}" ${field.group ? `data-split-group="${field.group}"` : ""}><label for="field-${field.name}">${field.label}</label>${control.replace(`name="${field.name}"`, `id="field-${field.name}" name="${field.name}"`)}</div>`;
}


function updateSplitCalculator() {
  const form = $("#dynamic-form");
  if (form.dataset.formType !== "split") return;
  const method = $("[name=split_method]", form).value;
  $$('[data-split-group]', form).forEach((field) => {
    const active = field.dataset.splitGroup === method;
    field.hidden = !active;
    $("input", field).required = active;
  });

  let first = 50;
  let help = "雙方平均分擔共同開支";
  if (method === "custom") {
    const value = Number($("[name=percentage]", form).value);
    first = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
    help = `另一方會自動負責餘下的 ${formatPercent(100 - first)}`;
  } else if (method === "income") {
    const incomes = [Number($("[name=income_one]", form).value), Number($("[name=income_two]", form).value)];
    const total = incomes.reduce((sum, value) => sum + Math.max(0, value || 0), 0);
    first = total > 0 ? Math.max(0, incomes[0]) / total * 100 : 50;
    help = total > 0 ? `按合共 ${money(total)} 每月收入計算` : "輸入雙方每月收入後自動計算";
  }
  $("#split-first-percent").textContent = formatPercent(first);
  $("#split-second-percent").textContent = formatPercent(100 - first);
  $("#split-help").textContent = help;
  $("#split-preview i").style.setProperty("--first-share", `${first}%`);
}

function closeModal({ saved = false } = {}) {
  if (state.submitting && !saved) return;
  cancelInvoiceOCR();
  cancelOrderImport();
  invoiceImage = null;
  $("#invoice-preview")?.removeAttribute("src");
  $("#modal-backdrop").hidden = true;
  document.body.style.overflow = "";
}

async function submitOnboarding(event) {
  event.preventDefault();
  if (state.submitting) return;
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const button = $("button[type=submit]", form);
  const payload = {
    couple_names: [values.partner_one, values.partner_two],
    monthly_budget: Number(values.monthly_budget),
    started_on: values.started_on,
  };
  state.submitting = true;
  button.disabled = true;
  button.innerHTML = `<span>正在建立空間…</span>`;
  try {
    await api("/api/onboarding", { method: "POST", body: JSON.stringify(payload) });
    await loadDashboard();
    toast("歡迎回來，你們的 Teletubbyland 已準備好");
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
    button.innerHTML = `<span>建立我們的空間</span>${icon("chevron")}`;
  } finally {
    state.submitting = false;
  }
}

async function submitForm(event) {
  event.preventDefault();
  if (state.submitting || invoiceRequest) return;
  const form = event.currentTarget;
  if (form.dataset.formType === "orderImport") return submitOrderImport(form);
  const config = forms[form.dataset.formType];
  const raw = Object.fromEntries(new FormData(form));
  const payload = config.transform ? config.transform(raw) : raw;
  if (form.dataset.formType === "expense" && form.dataset.method === "POST" && invoiceImage) {
    payload.invoice_image = invoiceImage;
    const duplicateConfirm = $("#invoice-duplicate-confirm", form);
    if (duplicateConfirm && !duplicateConfirm.checked) {
      duplicateConfirm.reportValidity();
      return;
    }
    if (duplicateConfirm?.checked) {
      payload.reviewed_invoice_ids = JSON.parse($("#invoice-duplicates", form).dataset.reviewIds);
    }
  }
  const button = $("button[type=submit]", form);
  state.submitting = true;
  button.disabled = true;
  button.textContent = "正在儲存…";
  const status = $("#form-save-status", form);
  status.hidden = true;
  let saved = false;
  try {
    const result = await api(form.dataset.endpoint, {
      method: form.dataset.method, body: JSON.stringify(payload),
      timeoutMs: payload.invoice_image ? 60_000 : 8000,
    });
    if (result?.ok !== true || (form.dataset.formType === "expense" && form.dataset.method === "POST" && !Number.isInteger(result.id))) {
      throw new Error("伺服器未確認儲存結果");
    }
    saved = true;
    if (form.dataset.formType === "categoryDelete") {
      const removedKey = decodeURIComponent(form.dataset.endpoint.split("/").pop());
      delete categories[removedKey];
      if (state.category === removedKey) state.category = "all";
      if (adminState.filters.category === removedKey) delete adminState.filters.category;
      updateCategoryDropdowns();
    }
    // OCR dates can fall outside the current month or active filters.
    const changedFilter = form.dataset.formType === "expense" && revealSavedExpense(payload);
    closeModal({ saved: true });
    toast(form.dataset.success + (changedFilter ? `，已切換至 ${monthLabel(state.month)}全部類別` : ""));
    await loadDashboard({ quiet: true, throwOnError: true });
    if ($("#admin-view") && !$("#admin-view").hidden) {
      await loadAdminTable(adminState.currentTable);
      await loadAdminOverview();
    }
  } catch (error) {
    if (saved) {
      const message = "資料已儲存，但清單載入失敗。請重新載入，毋須再次提交。";
      renderLoadError(message);
      toast(message, true);
    } else if (error.code === "duplicate_invoice" && Array.isArray(error.duplicates)) {
      showInvoiceDuplicates(error.duplicates, form);
      $("#invoice-duplicates", form).scrollIntoView({ block: "nearest" });
      status.textContent = "尚未儲存：請先查看疑似重複的單據圖片。";
      status.hidden = false;
      button.disabled = false;
      button.textContent = "確認並記帳";
    } else {
      status.textContent = `${error.message}。未能確認是否已儲存，請先查看記錄再重試，以免重複記帳。`;
      status.hidden = false;
      toast(error.message, true);
      button.disabled = false;
      button.textContent = "再試一次";
    }
  } finally {
    state.submitting = false;
  }
}

function revealSavedExpense(payload) {
  const spentOn = payload.spent_on || localISODate();
  const filter = state.data?.filter;
  const visible = filter && spentOn >= filter.date_from && spentOn <= filter.date_to
    && (filter.category === "all" || filter.category === payload.category);
  if (visible) return false;
  state.month = spentOn.slice(0, 7);
  state.period = "month";
  state.category = "all";
  return true;
}

async function toggleTodo(id, value, button) {
  button.disabled = true;
  try {
    await api(`/api/todos/${id}`, { method: "PATCH", body: JSON.stringify({ done: Boolean(value) }) });
    if (value) celebrate(button);
    toast(value ? "完成一件生活小事" : "已恢復項目");
    await loadDashboard({ quiet: true });
    if ($("#admin-view") && !$("#admin-view").hidden) {
      await loadAdminTable(adminState.currentTable);
      await loadAdminOverview();
    }
  } catch (error) {
    button.disabled = false;
    toast(error.message, true);
  }
}

async function clearCompletedShopping() {
  if (!window.confirm("清理所有已完成的購物項目？已記錄的開支會保留。")) return;
  try {
    const result = await api("/api/shopping/completed", { method: "DELETE" });
    toast(`已清理 ${result.removed} 個項目，開支紀錄已保留`);
    await loadDashboard({ quiet: true });
    if ($("#admin-view") && !$("#admin-view").hidden) {
      await loadAdminTable(adminState.currentTable);
      await loadAdminOverview();
    }
  } catch (error) {
    toast(error.message, true);
  }
}

async function deleteItem(type, id, button) {
  button.disabled = true;
  try {
    await api(`/api/${type}/${id}`, { method: "DELETE" });
    toast("已經移除了");
    await loadDashboard({ quiet: true });
    if ($("#admin-view") && !$("#admin-view").hidden) {
      await loadAdminTable(adminState.currentTable);
      await loadAdminOverview();
    }
  } catch (error) {
    button.disabled = false;
    toast(error.message, true);
  }
}


function toast(message, error = false) {
  const element = document.createElement("div");
  element.className = `toast ${error ? "error" : ""}`;
  element.innerHTML = `<span>${error ? "!" : "✓"}</span>${esc(message)}`;
  $("#toast-region").append(element);
  setTimeout(() => element.remove(), 3100);
}

function celebrate(source) {
  const rect = source.getBoundingClientRect();
  ["#ed765f", "#eeb35b", "#6e9880", "#7775a8"].forEach((color, index) => {
    const particle = document.createElement("i");
    particle.style.cssText = `position:fixed;z-index:150;left:${rect.left + rect.width / 2}px;top:${rect.top + rect.height / 2}px;width:5px;height:5px;border-radius:50%;background:${color};pointer-events:none;transition:all .55s cubic-bezier(.2,.8,.2,1);`;
    document.body.append(particle);
    requestAnimationFrame(() => {
      const angle = Math.PI * .5 * index + .3;
      particle.style.transform = `translate(${Math.cos(angle) * 30}px, ${Math.sin(angle) * 30}px) scale(0)`;
      particle.style.opacity = "0";
    });
    setTimeout(() => particle.remove(), 600);
  });
}

function toggleEditMode(force) {
  state.editing = force ?? !state.editing;
  $("#layout-toolbar").hidden = !state.editing;
  $("#edit-layout").classList.toggle("primary", state.editing);
  $("#edit-layout").classList.toggle("secondary", !state.editing);
  renderDashboard();
  if (state.editing) toast("拖曳卡片排序，手機也可用縮放按鈕調整");
}

function layoutAction(action, widget) {
  const item = state.data.layout.find((entry) => entry.id === widget.dataset.widgetId);
  if (!item) return;
  if (action === "resize") {
    const sizes = ["small", "medium", "large", "wide"];
    item.size = sizes[(sizes.indexOf(item.size) + 1) % sizes.length];
    widget.className = widget.className.replace(/size-(small|medium|large|wide)/, `size-${item.size}`);
    widget.dataset.size = item.size;
    toast(`卡片尺寸：${({ small: "小", medium: "中", large: "大", wide: "滿版" })[item.size]}`);
  } else if (action === "hide") {
    item.hidden = true;
    widget.classList.add("hidden-widget");
    toast("卡片已隱藏，可按「顯示全部」恢復");
  } else if (action === "up" || action === "down") {
    const index = state.data.layout.indexOf(item);
    const target = index + (action === "up" ? -1 : 1);
    if (target < 0 || target >= state.data.layout.length) return;
    [state.data.layout[index], state.data.layout[target]] = [state.data.layout[target], state.data.layout[index]];
    state.data.layout.forEach((entry, order) => { entry.order = order; });
    renderDashboard();
  }
}

function setupDragAndDrop() {
  if (!state.editing) return;
  $$(".widget", $("#dashboard-grid")).forEach((widget) => {
    widget.addEventListener("dragstart", () => {
      state.draggedId = widget.dataset.widgetId;
      widget.classList.add("dragging");
    });
    widget.addEventListener("dragend", () => {
      state.draggedId = null;
      widget.classList.remove("dragging");
      $$(".widget.drag-over").forEach((item) => item.classList.remove("drag-over"));
      syncLayoutFromDOM();
    });
    widget.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (widget.dataset.widgetId !== state.draggedId) widget.classList.add("drag-over");
    });
    widget.addEventListener("dragleave", () => widget.classList.remove("drag-over"));
    widget.addEventListener("drop", (event) => {
      event.preventDefault();
      const dragged = $(`[data-widget-id="${state.draggedId}"]`);
      if (!dragged || dragged === widget) return;
      const grid = $("#dashboard-grid");
      const rect = widget.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2 || (Math.abs(event.clientY - (rect.top + rect.height / 2)) < rect.height / 4 && event.clientX > rect.left + rect.width / 2);
      grid.insertBefore(dragged, after ? widget.nextSibling : widget);
      widget.classList.remove("drag-over");
      syncLayoutFromDOM();
    });
  });
}

function syncLayoutFromDOM() {
  const ids = $$(".widget", $("#dashboard-grid")).map((widget) => widget.dataset.widgetId);
  state.data.layout.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  state.data.layout.forEach((item, index) => { item.order = index; });
}

async function saveLayout() {
  syncLayoutFromDOM();
  try {
    await api("/api/settings", { method: "PATCH", body: JSON.stringify({ layout: state.data.layout }) });
    toggleEditMode(false);
    toast("版面已儲存，每次回來都會保持這個樣子");
  } catch (error) {
    toast(error.message, true);
  }
}

function restoreWidgets() {
  state.data.layout.forEach((item) => { item.hidden = false; });
  renderDashboard();
  toast("所有卡片都回來了");
}

function applyExpenseFilters({ month = state.month, period = state.period, category = state.category } = {}) {
  state.month = month;
  state.period = period;
  state.category = category;
  updateExpenseFilters();
  loadDashboard({ quiet: true });
}

/* ==========================================================================
   Admin & Parameter Dashboard Controller
   ========================================================================== */

const adminState = {
  currentTable: "categories",
  search: "",
  filters: {},
  overview: null,
  tableData: null,
  loading: false,
  debounceTimer: null,
};

function switchView(viewName) {
  const isLiving = viewName !== "admin";
  const living = $("#living-view");
  const admin = $("#admin-view");
  if (!living || !admin) return;

  living.hidden = !isLiving;
  admin.hidden = isLiving;

  $$(".side-nav .nav-link").forEach((link) => {
    link.classList.toggle("active", isLiving ? link.dataset.section === "dashboard" : link.dataset.section === "admin");
  });
  $$(".mobile-nav a").forEach((link) => {
    link.classList.toggle("active", isLiving ? link.dataset.section === "dashboard" : link.dataset.section === "admin");
  });

  if (!isLiving) {
    if (location.hash !== "#admin") history.replaceState(null, "", "#admin");
    initAdminDashboard();
  } else {
    if (location.hash === "#admin") history.replaceState(null, "", "#top");
  }
}

async function initAdminDashboard() {
  await loadAdminOverview();
  await loadAdminTable(adminState.currentTable);
}

async function loadAdminOverview() {
  try {
    const data = await api("/api/admin/overview");
    adminState.overview = data;
    renderAdminMetrics(data);
    if (data.counts) {
      Object.entries(data.counts).forEach(([tableName, count]) => {
        const badge = $(`#badge-${tableName}`);
        if (badge) badge.textContent = count;
      });
    }
  } catch (err) {
    console.error("Failed to load admin overview", err);
  }
}

function renderAdminMetrics(data) {
  const container = $("#admin-metrics-grid");
  if (!container || !data) return;
  const c = data.counts || {};
  container.innerHTML = `
    <div class="admin-metric-card" style="--accent: var(--coral);">
      <div class="metric-icon"><svg><use href="#i-tag"/></svg></div>
      <div class="metric-body">
        <span class="metric-label">記帳分類總數</span>
        <strong class="metric-value">${c.categories || 0} 個</strong>
        <small class="metric-sub">${data.custom_categories_count || 0} 個自訂分類</small>
      </div>
    </div>
    <div class="admin-metric-card" style="--accent: var(--yellow);">
      <div class="metric-icon"><svg><use href="#i-wallet"/></svg></div>
      <div class="metric-body">
        <span class="metric-label">共同開支紀錄</span>
        <strong class="metric-value">${money(data.total_expense_amount || 0)}</strong>
        <small class="metric-sub">累計記錄 ${data.total_expense_count || 0} 筆開支</small>
      </div>
    </div>
    <div class="admin-metric-card" style="--accent: var(--green);">
      <div class="metric-icon"><svg><use href="#i-cart"/></svg></div>
      <div class="metric-body">
        <span class="metric-label">購物清單項目</span>
        <strong class="metric-value">${c.shopping_items || 0} 項</strong>
        <small class="metric-sub">待購與已完成項目</small>
      </div>
    </div>
    <div class="admin-metric-card" style="--accent: var(--purple);">
      <div class="metric-icon"><svg><use href="#i-check"/></svg></div>
      <div class="metric-body">
        <span class="metric-label">日常待辦事項</span>
        <strong class="metric-value">${c.todos || 0} 件</strong>
        <small class="metric-sub">未完成與歷史待辦</small>
      </div>
    </div>
    <div class="admin-metric-card" style="--accent: #5e9ddb;">
      <div class="metric-icon"><svg><use href="#i-sliders"/></svg></div>
      <div class="metric-body">
        <span class="metric-label">系統設定參數</span>
        <strong class="metric-value">${c.settings || 0} 項</strong>
        <small class="metric-sub">預算、分帳、交往紀念日</small>
      </div>
    </div>
    <div class="admin-metric-card" style="--accent: #78a186;">
      <div class="metric-icon"><svg><use href="#i-database"/></svg></div>
      <div class="metric-body">
        <span class="metric-label">SQLite 資料庫</span>
        <strong class="metric-value">${data.db_size_formatted || "運作中"}</strong>
        <small class="metric-sub">Schema v${data.schema_version} · WAL 模式</small>
      </div>
    </div>
  `;
}

async function loadAdminTable(tableName) {
  adminState.currentTable = tableName;
  const container = $("#admin-table-container");
  if (container) {
    container.innerHTML = '<div class="admin-loading-indicator"><div class="skeleton-card" style="height:200px;margin:16px;"></div></div>';
  }

  $$(".admin-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.adminTable === tableName);
  });

  const labels = {
    categories: "新增分類",
    settings: "新增參數",
    expenses: "記一筆開支",
    shopping_items: "新增購物項目",
    todos: "新增待辦",
    special_days: "收藏特別日子",
  };
  const addLabel = $("#admin-add-label");
  if (addLabel) addLabel.textContent = labels[tableName] || "新增紀錄";

  renderAdminContextFilters(tableName);

  const params = new URLSearchParams({ limit: "300" });
  if (adminState.search) params.append("search", adminState.search);
  Object.entries(adminState.filters).forEach(([k, v]) => {
    if (v && v !== "all") params.append(k, v);
  });

  try {
    const data = await api(`/api/admin/tables/${tableName}?${params}`);
    adminState.tableData = data;
    renderAdminTable(data);
    const summary = $("#admin-count-summary");
    if (summary) {
      summary.textContent = `共 ${data.total} 筆紀錄${adminState.search || Object.keys(adminState.filters).length ? "（已套用篩選）" : ""}`;
    }
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="empty-state"><span>!</span><p>${esc(err.message)}</p></div>`;
    }
  }
}

function renderAdminContextFilters(tableName) {
  const container = $("#admin-context-filters");
  if (!container) return;

  if (tableName === "categories") {
    container.innerHTML = `
      <select id="admin-filter-cat-type" class="admin-filter-select" aria-label="分類類型篩選">
        <option value="all">全部分類類型</option>
        <option value="default" ${adminState.filters.type === "default" ? "selected" : ""}>系統預設</option>
        <option value="custom" ${adminState.filters.type === "custom" ? "selected" : ""}>自訂分類</option>
      </select>
    `;
  } else if (tableName === "expenses") {
    container.innerHTML = `
      <select id="admin-filter-category" class="admin-filter-select" aria-label="開支分類篩選">
        <option value="all">全部開支分類</option>
        ${Object.entries(categories).map(([k, v]) => `<option value="${esc(k)}" ${adminState.filters.category === k ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
      </select>
      <select id="admin-filter-payer" class="admin-filter-select" aria-label="付款人篩選">
        <option value="all">全部付款人</option>
        ${state.data?.settings?.couple_names ? state.data.settings.couple_names.map((name) => `<option value="${esc(name)}" ${adminState.filters.paid_by === name ? "selected" : ""}>${esc(name)}</option>`).join("") : ""}
        <option value="共同" ${adminState.filters.paid_by === "共同" ? "selected" : ""}>共同</option>
      </select>
    `;
  } else if (tableName === "shopping_items") {
    container.innerHTML = `
      <select id="admin-filter-purchased" class="admin-filter-select" aria-label="購買狀態篩選">
        <option value="all">全部狀態</option>
        <option value="0" ${adminState.filters.purchased === "0" ? "selected" : ""}>待購買</option>
        <option value="1" ${adminState.filters.purchased === "1" ? "selected" : ""}>已入帳完成</option>
      </select>
    `;
  } else if (tableName === "todos") {
    container.innerHTML = `
      <select id="admin-filter-done" class="admin-filter-select" aria-label="待辦狀態篩選">
        <option value="all">全部狀態</option>
        <option value="0" ${adminState.filters.done === "0" ? "selected" : ""}>進行中</option>
        <option value="1" ${adminState.filters.done === "1" ? "selected" : ""}>已完成</option>
      </select>
    `;
  } else if (tableName === "special_days") {
    container.innerHTML = `
      <select id="admin-filter-repeats" class="admin-filter-select" aria-label="重複規則篩選">
        <option value="all">全部提醒模式</option>
        <option value="1" ${adminState.filters.repeats_yearly === "1" ? "selected" : ""}>每年提醒</option>
        <option value="0" ${adminState.filters.repeats_yearly === "0" ? "selected" : ""}>單次提醒</option>
      </select>
    `;
  } else {
    container.innerHTML = "";
  }
}

function renderAdminTable(data) {
  const container = $("#admin-table-container");
  if (!container) return;

  const rows = data.rows || [];
  if (!rows.length) {
    container.innerHTML = emptyState("此資料表目前沒有符合條件的資料", "⌁");
    return;
  }

  const table = data.table;
  let theadHtml = "";
  let tbodyHtml = "";

  if (table === "categories") {
    theadHtml = `
      <tr>
        <th style="width: 140px;">代碼 (Key)</th>
        <th>名稱</th>
        <th style="width: 100px;">圖示</th>
        <th style="width: 130px;">代表色</th>
        <th style="width: 110px;">類型</th>
        <th style="width: 150px;">關聯開支</th>
        <th style="width: 110px;">操作</th>
      </tr>
    `;
    tbodyHtml = rows.map((cat) => `
      <tr>
        <td><code>${esc(cat.key)}</code></td>
        <td><strong>${esc(cat.label)}</strong></td>
        <td><span class="admin-icon-tag"><svg><use href="#i-${esc(cat.icon || "dots")}"/></svg> ${esc(cat.icon || "dots")}</span></td>
        <td>
          <div class="admin-color-chip">
            <span class="color-swatch" style="background:${esc(cat.color)};"></span>
            <code>${esc(cat.color)}</code>
          </div>
        </td>
        <td>
          ${cat.is_default
            ? '<span class="admin-badge system">系統預設</span>'
            : '<span class="admin-badge custom">自訂分類</span>'}
        </td>
        <td><span class="admin-count-pill">${cat.expense_count || 0} 筆開支 · ${cat.shopping_count || 0} 項購物</span></td>
        <td>
          <div class="admin-row-actions">
            <button type="button" class="icon-button edit" data-admin-edit="categories" data-id="${esc(cat.key)}" title="編輯分類">${icon("edit")}</button>
            <button type="button" class="icon-button delete" data-admin-delete="categories" data-id="${esc(cat.key)}" title="移轉／移除分類" aria-label="移轉／移除分類">${icon("trash")}</button>
          </div>
        </td>
      </tr>
    `).join("");
  } else if (table === "settings") {
    theadHtml = `
      <tr>
        <th style="width: 220px;">參數鍵名 (Key)</th>
        <th>目前數值 (Value)</th>
        <th style="width: 110px;">操作</th>
      </tr>
    `;
    const protectedKeys = new Set(["onboarding_complete", "couple_names", "monthly_budget", "started_on"]);
    tbodyHtml = rows.map((setting) => {
      const isProtected = protectedKeys.has(setting.key);
      const valStr = typeof setting.parsed_value === "object"
        ? JSON.stringify(setting.parsed_value, null, 2)
        : String(setting.value ?? "");
      return `
        <tr>
          <td>
            <strong>${esc(setting.key)}</strong>
            ${isProtected ? '<span class="admin-badge system">核心</span>' : '<span class="admin-badge custom">自訂</span>'}
          </td>
          <td><pre class="admin-json-preview">${esc(valStr)}</pre></td>
          <td>
            <div class="admin-row-actions">
              <button type="button" class="icon-button edit" data-admin-edit="settings" data-id="${esc(setting.key)}" title="編輯參數">${icon("edit")}</button>
              ${isProtected ? "" : `<button type="button" class="icon-button delete" data-admin-delete="settings" data-id="${esc(setting.key)}" title="刪除參數">${icon("trash")}</button>`}
            </div>
          </td>
        </tr>
      `;
    }).join("");
  } else if (table === "expenses") {
    theadHtml = `
      <tr>
        <th style="width: 60px;">ID</th>
        <th>開支項目</th>
        <th style="width: 120px;">金額</th>
        <th style="width: 130px;">分類</th>
        <th style="width: 100px;">付款人</th>
        <th style="width: 120px;">日期</th>
        <th style="width: 100px;">操作</th>
      </tr>
    `;
    tbodyHtml = rows.map((item) => {
      const meta = categories[item.category] || categories.other || { label: item.category, color: "#a8a59e" };
      return `
        <tr>
          <td><small class="admin-id">#${item.id}</small></td>
          <td><strong>${esc(item.title)}</strong></td>
          <td><strong class="admin-amount">${money(item.amount)}</strong></td>
          <td>
            <span class="admin-cat-pill" style="--cat-color:${meta.color}">
              <span class="dot"></span>${esc(meta.label || item.category)}
            </span>
          </td>
          <td><span class="admin-badge payer">${esc(item.paid_by)}</span></td>
          <td><small>${esc(item.spent_on)}</small></td>
          <td>
            <div class="admin-row-actions">
              <button type="button" class="icon-button edit" data-admin-edit="expenses" data-id="${item.id}" title="編輯開支">${icon("edit")}</button>
              <button type="button" class="icon-button delete" data-admin-delete="expenses" data-id="${item.id}" title="刪除開支">${icon("trash")}</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  } else if (table === "shopping_items") {
    theadHtml = `
      <tr>
        <th style="width: 60px;">ID</th>
        <th>物品名稱</th>
        <th style="width: 90px;">數量</th>
        <th style="width: 130px;">分類</th>
        <th style="width: 110px;">狀態</th>
        <th style="width: 100px;">操作</th>
      </tr>
    `;
    tbodyHtml = rows.map((item) => {
      const meta = categories[item.category] || categories.other || { label: item.category, color: "#a8a59e" };
      return `
        <tr>
          <td><small class="admin-id">#${item.id}</small></td>
          <td><strong>${esc(item.name)}</strong></td>
          <td>${item.quantity}</td>
          <td>
            <span class="admin-cat-pill" style="--cat-color:${meta.color}">
              <span class="dot"></span>${esc(meta.label || item.category)}
            </span>
          </td>
          <td>
            ${item.purchased
              ? '<span class="admin-badge done">已入帳</span>'
              : '<span class="admin-badge pending">待購買</span>'}
          </td>
          <td>
            <div class="admin-row-actions">
              <button type="button" class="icon-button edit" data-admin-edit="shopping_items" data-id="${item.id}" title="編輯購物項目">${icon("edit")}</button>
              <button type="button" class="icon-button delete" data-admin-delete="shopping_items" data-id="${item.id}" title="刪除購物項目">${icon("trash")}</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  } else if (table === "todos") {
    theadHtml = `
      <tr>
        <th style="width: 60px;">ID</th>
        <th>待辦事項</th>
        <th style="width: 110px;">負責人</th>
        <th style="width: 120px;">到期日</th>
        <th style="width: 110px;">狀態</th>
        <th style="width: 100px;">操作</th>
      </tr>
    `;
    tbodyHtml = rows.map((item) => `
      <tr>
        <td><small class="admin-id">#${item.id}</small></td>
        <td><strong>${esc(item.title)}</strong></td>
        <td><span class="admin-badge payer">${esc(item.assignee)}</span></td>
        <td><small>${shortDate(item.due_date)}</small></td>
        <td>
          ${item.done
            ? '<span class="admin-badge done">已完成</span>'
            : '<span class="admin-badge pending">進行中</span>'}
        </td>
        <td>
          <div class="admin-row-actions">
            <button type="button" class="icon-button edit" data-admin-edit="todos" data-id="${item.id}" title="編輯待辦">${icon("edit")}</button>
            <button type="button" class="icon-button delete" data-admin-delete="todos" data-id="${item.id}" title="刪除待辦">${icon("trash")}</button>
          </div>
        </td>
      </tr>
    `).join("");
  } else if (table === "special_days") {
    theadHtml = `
      <tr>
        <th style="width: 60px;">ID</th>
        <th style="width: 60px;">記號</th>
        <th>特別日子</th>
        <th style="width: 130px;">日期</th>
        <th style="width: 110px;">每年重複</th>
        <th style="width: 100px;">操作</th>
      </tr>
    `;
    tbodyHtml = rows.map((item) => `
      <tr>
        <td><small class="admin-id">#${item.id}</small></td>
        <td><span style="font-size: 18px;">${esc(item.emoji)}</span></td>
        <td><strong>${esc(item.title)}</strong></td>
        <td><small>${esc(item.event_date)}</small></td>
        <td>${item.repeats_yearly ? '<span class="admin-badge system">每年</span>' : '<span class="admin-badge">單次</span>'}</td>
        <td>
          <div class="admin-row-actions">
            <button type="button" class="icon-button edit" data-admin-edit="special_days" data-id="${item.id}" title="編輯日子">${icon("edit")}</button>
            <button type="button" class="icon-button delete" data-admin-delete="special_days" data-id="${item.id}" title="刪除日子">${icon("trash")}</button>
          </div>
        </td>
      </tr>
    `).join("");
  }

  container.innerHTML = `
    <table class="admin-data-table">
      <thead>${theadHtml}</thead>
      <tbody>${tbodyHtml}</tbody>
    </table>
  `;
}

async function exportCurrentTableToExcel() {
  const table = adminState.currentTable;
  const search = adminState.search;
  const params = new URLSearchParams({ table });
  if (search) params.append("search", search);
  Object.entries(adminState.filters).forEach(([k, v]) => {
    if (v && v !== "all") params.append(k, v);
  });

  try {
    toast("正在匯出 Excel 格式資料…");
    const response = await fetch(`/api/admin/export?${params}`);
    if (!response.ok) throw new Error("匯出失敗，請稍後再試");
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition");
    let filename = `teletubbyland-${table}-${localISODate()}.csv`;
    if (disposition && disposition.includes("filename=")) {
      filename = disposition.split("filename=")[1].replace(/["']/g, "").trim();
    }
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    toast(`已成功匯出 ${filename}`);
  } catch (err) {
    toast(err.message, true);
  }
}

function openAdminAdd() {
  const table = adminState.currentTable;
  if (table === "categories") openModal("categoryCreate");
  else if (table === "settings") openModal("adminSettingCreate");
  else if (table === "expenses") openModal("expense");
  else if (table === "shopping_items") openModal("shopping");
  else if (table === "todos") openModal("todo");
  else if (table === "special_days") openModal("event");
}

function openAdminEdit(table, idOrKey) {
  if (table === "categories") {
    const item = adminState.tableData?.rows?.find((r) => r.key === idOrKey) || { key: idOrKey, label: categories[idOrKey]?.label || idOrKey };
    openModal("categoryEdit", { item });
  } else if (table === "settings") {
    const item = adminState.tableData?.rows?.find((r) => r.key === idOrKey) || { key: idOrKey, value: "" };
    openModal("adminSettingEdit", { item });
  } else if (table === "expenses") {
    openExpenseEditor(idOrKey);
  } else if (table === "shopping_items") {
    openShoppingEditor(idOrKey);
  } else if (table === "todos") {
    const item = adminState.tableData?.rows?.find((r) => String(r.id) === String(idOrKey));
    if (item) openModal("todoEdit", { item });
  } else if (table === "special_days") {
    const item = adminState.tableData?.rows?.find((r) => String(r.id) === String(idOrKey));
    if (item) openModal("specialDayEdit", { item });
  }
}

async function deleteAdminEntry(table, idOrKey) {
  if (table === "categories") {
    try {
      const list = await api("/api/categories");
      syncCategories(list);
      const item = list.find((c) => c.key === idOrKey);
      if (!item) throw new Error("找不到指定分類");
      if (item.expense_count + item.shopping_count > 0) {
        openModal("categoryDelete", { item, targets: list });
        return;
      }
      if (!window.confirm(`「${item.label}」沒有開支或購物項目，確定永久刪除此分類的資料庫記錄？`)) return;
      await api(`/api/categories/${encodeURIComponent(idOrKey)}`, { method: "DELETE" });
      syncCategories(list.filter((c) => c.key !== idOrKey));
      toast("分類已從資料庫移除");
      await loadDashboard({ quiet: true });
      await loadAdminTable(adminState.currentTable);
      await loadAdminOverview();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }
  const confirmMsg = table === "settings" ? `確定要刪除系統參數「${idOrKey}」嗎？` : "確定要刪除這筆資料嗎？";
  if (!window.confirm(confirmMsg)) return;

  try {
    if (table === "settings") {
      await api(`/api/admin/settings/${encodeURIComponent(idOrKey)}`, { method: "DELETE" });
    } else {
      await api(`/api/${table}/${idOrKey}`, { method: "DELETE" });
    }
    toast("已成功刪除");
    await loadDashboard({ quiet: true });
    await loadAdminTable(adminState.currentTable);
    await loadAdminOverview();
  } catch (error) {
    toast(error.message, true);
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const periodButton = event.target.closest("[data-expense-period]");
    if (periodButton) {
      const period = periodButton.dataset.expensePeriod;
      return applyExpenseFilters({
        period,
        month: period === "month" ? state.month : localMonth(),
      });
    }

    if (event.target.closest("#reset-expense-filter")) {
      return applyExpenseFilters({ month: localMonth(), period: "month", category: "all" });
    }

    // Navigation switching
    const navLink = event.target.closest("[data-section]");
    if (navLink) {
      const section = navLink.dataset.section;
      if (section === "admin") {
        return switchView("admin");
      } else {
        return switchView("living");
      }
    }

    if (event.target.closest("#admin-back-to-app")) {
      return switchView("living");
    }

    if (event.target.closest("#admin-refresh-btn")) {
      initAdminDashboard();
      return toast("已重新整理資料庫數據");
    }

    const adminTab = event.target.closest("[data-admin-table]");
    if (adminTab) {
      return loadAdminTable(adminTab.dataset.adminTable);
    }

    if (event.target.closest("#admin-export-excel")) {
      return exportCurrentTableToExcel();
    }

    if (event.target.closest("#admin-add-entry-btn")) {
      return openAdminAdd();
    }

    const adminEdit = event.target.closest("[data-admin-edit]");
    if (adminEdit) {
      return openAdminEdit(adminEdit.dataset.adminEdit, adminEdit.dataset.id);
    }

    const adminDelete = event.target.closest("[data-admin-delete]");
    if (adminDelete) {
      return deleteAdminEntry(adminDelete.dataset.adminDelete, adminDelete.dataset.id);
    }

    if (event.target.closest("#admin-clear-search")) {
      adminState.search = "";
      $("#admin-search-input").value = "";
      $("#admin-clear-search").hidden = true;
      return loadAdminTable(adminState.currentTable);
    }

    const modalButton = event.target.closest("[data-open-modal]");
    if (modalButton) return openModal(modalButton.dataset.openModal);

    const settingsButton = event.target.closest(".settings-trigger");
    if (settingsButton) return openModal("settings");

    const completeShopping = event.target.closest("[data-complete-shopping]");
    if (completeShopping) return openShoppingCompletion(completeShopping.dataset.completeShopping);

    const todo = event.target.closest("[data-toggle-todo]");
    if (todo) return toggleTodo(todo.dataset.toggleTodo, Number(todo.dataset.value), todo);

    const editExpense = event.target.closest("[data-edit-expense]");
    if (editExpense) return openExpenseEditor(editExpense.dataset.editExpense);

    const editShopping = event.target.closest("[data-edit-shopping]");
    if (editShopping) return openShoppingEditor(editShopping.dataset.editShopping);

    const editSpecialDay = event.target.closest("[data-edit-special-day]");
    if (editSpecialDay) return openSpecialDayEditor(editSpecialDay.dataset.editSpecialDay);

    if (event.target.closest("[data-clear-shopping]")) return clearCompletedShopping();

    const remove = event.target.closest("[data-delete]");
    if (remove) return deleteItem(remove.dataset.delete, remove.dataset.id, remove);

    const layoutButton = event.target.closest("[data-layout-action]");
    if (layoutButton) return layoutAction(layoutButton.dataset.layoutAction, layoutButton.closest(".widget"));

    if (event.target.closest("#close-modal") || event.target.closest("#cancel-modal")) return closeModal();
    if (event.target === $("#modal-backdrop")) return closeModal();
    if (event.target.closest("#retry-load")) return loadDashboard();
    if (event.target.closest("#edit-layout")) return toggleEditMode();
    if (event.target.closest("#save-layout")) return saveLayout();
    if (event.target.closest("#restore-widgets")) return restoreWidgets();
    if (event.target.closest(".notification-button")) {
      refreshSpecialDayDates();
      const reminder = updateSpecialDayNotification();
      switchView("living");
      $("#moments")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return toast(reminder.message);
    }
  });

  $("#dynamic-form").addEventListener("submit", submitForm);
  $("#onboarding-form").addEventListener("submit", submitOnboarding);
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-invoice-file]")) {
      const file = event.target.files[0];
      event.target.value = "";
      if (file) recognizeInvoice(file);
    }
    if (event.target.id === "global-month" && event.target.value) {
      applyExpenseFilters({ month: event.target.value, period: "month" });
    }
    if (event.target.id === "expense-category-filter") {
      applyExpenseFilters({ category: event.target.value });
    }
    if (event.target.closest("#admin-context-filters")) {
      const select = event.target;
      if (select.id === "admin-filter-cat-type") adminState.filters.type = select.value;
      if (select.id === "admin-filter-category") adminState.filters.category = select.value;
      if (select.id === "admin-filter-payer") adminState.filters.paid_by = select.value;
      if (select.id === "admin-filter-purchased") adminState.filters.purchased = select.value;
      if (select.id === "admin-filter-done") adminState.filters.done = select.value;
      if (select.id === "admin-filter-repeats") adminState.filters.repeats_yearly = select.value;
      loadAdminTable(adminState.currentTable);
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "admin-search-input") {
      clearTimeout(adminState.debounceTimer);
      adminState.debounceTimer = setTimeout(() => {
        adminState.search = event.target.value.trim();
        $("#admin-clear-search").hidden = !adminState.search;
        loadAdminTable(adminState.currentTable);
      }, 250);
    }
  });

  ["input", "change"].forEach((eventName) => document.addEventListener(eventName, (event) => {
    if (event.target.closest("#dynamic-form")?.dataset.formType === "split") updateSplitCalculator();
  }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshSpecialDayDates();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#modal-backdrop").hidden) closeModal();
  });

  window.addEventListener("hashchange", () => {
    if (location.hash === "#admin" || location.hash === "#params") {
      switchView("admin");
    } else if (state.data?.configured && !$("#admin-view").hidden) {
      switchView("living");
    }
  });
}

function setupTime() {
  const now = new Date();
  const hour = now.getHours();
  $("#greeting").textContent = hour < 11 ? "早晨" : hour < 18 ? "午安" : "晚安";
  $("#today-label").textContent = now.toLocaleDateString(state.data?.preferences?.locale || "zh-HK", { month: "long", day: "numeric", weekday: "long" });
  if (state.data?.settings.started_on) {
    const origin = new Date(`${state.data.settings.started_on}T00:00:00`);
    $("#together-days").textContent = `${Math.max(1, Math.floor((now - origin) / 86400000) + 1)} 天`;
  }
}

setupTime();
setInterval(refreshSpecialDayDates, 60_000);
bindEvents();
loadDashboard().then(() => {
  if (location.hash === "#admin" || location.hash === "#params") {
    switchView("admin");
  }
});
