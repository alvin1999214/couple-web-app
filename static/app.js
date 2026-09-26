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
  if (Array.isArray(list) && list.length) {
    list.forEach((c) => {
      categories[c.key] = {
        label: c.label,
        color: c.color || "#a8a59e",
        icon: c.icon || "dots",
        is_default: c.is_default,
      };
    });
    updateCategoryDropdowns();
  }
}

function updateCategoryDropdowns() {
  const select = $("#expense-category-filter");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="all">全部類別</option>' + Object.entries(categories).map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`).join("");
  if (categories[current] || current === "all") select.value = current;
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
  try {
    const response = await fetch(path, {
      ...requestOptions,
      headers: { "Content-Type": "application/json", ...headers },
      signal: signal || controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "連線發生問題");
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("連線已取消或逾時，請重試");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadDashboard({ quiet = false } = {}) {
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
    const meta = categories[item.category] || categories.other;
    return `<div class="expense-row">
      <span class="category-dot" style="background:${meta.color}"></span>
      <span class="expense-info"><strong>${esc(item.title)}</strong><small>${expenseDate(item.spent_on)} · ${meta.label} · ${esc(item.paid_by)}</small></span>
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

function nextEventDate(item) {
  let next = new Date(`${item.event_date}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (item.repeats_yearly && next < now) {
    next.setFullYear(now.getFullYear());
    if (next < now) next.setFullYear(now.getFullYear() + 1);
  }
  return next;
}

function renderMoments() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const items = [...state.data.special_days].sort((a, b) => nextEventDate(a) - nextEventDate(b));
  const content = items.length ? items.slice(0, 3).map((item) => {
    const next = nextEventDate(item);
    const days = Math.max(0, Math.round((next - now) / 86400000));
    return `<div class="event-card">
      <div class="event-date"><strong>${next.getDate()}</strong><small>${next.toLocaleDateString(state.data?.preferences?.locale || "zh-HK", { month: "short" })}</small></div>
      <div class="event-info"><strong>${esc(item.title)}</strong><small>${days === 0 ? "就是今日" : `還有 ${days} 天`} ${item.repeats_yearly ? "· 每年" : ""}</small></div>
      <span class="event-emoji">${esc(item.emoji)}</span>
      <button class="delete-row" data-delete="special-days" data-id="${item.id}" aria-label="刪除 ${esc(item.title)}">${icon("trash")}</button>
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
  if (!state.data) return;
  const config = forms[type];
  if (!config) return;
  cancelInvoiceOCR();
  const variant = context.item && config.edit ? config.edit : {};
  const effective = { ...config, ...variant };
  $("#modal-title").textContent = effective.title;
  const fields = config.fields(context).map(renderField).join("");
  const extra = typeof effective.extra === "function" ? effective.extra(context) : (effective.extra || "");
  $("#dynamic-form").innerHTML = `${type === "expense" && !context.item ? invoiceControls() : ""}${fields}${extra}${effective.note ? `<p class="form-note">${effective.note}</p>` : ""}
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

let invoiceRequest = null;

function cancelInvoiceOCR() {
  invoiceRequest?.abort();
  invoiceRequest = null;
}

function invoiceControls() {
  return `<section class="invoice-scan" aria-label="單據識別">
    <div class="invoice-buttons">
      <label class="button secondary invoice-file">${icon("plus")} 拍攝單據<input type="file" accept="image/*" capture="environment" data-invoice-file aria-label="拍攝單據"></label>
      <label class="button secondary invoice-file">${icon("plus")} 上傳單據<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-invoice-file aria-label="上傳單據"></label>
    </div>
    <p class="form-note">照片將傳送至 AI 服務進行識別。</p>
    <p id="invoice-status" role="status" aria-live="polite"></p>
    <img id="invoice-preview" alt="待核對的單據" hidden>
    <ul id="invoice-warnings" hidden></ul>
    <label class="invoice-confirm" hidden><input type="checkbox" id="invoice-confirm">已核對單據及港幣金額</label>
  </section>`;
}

async function prepareInvoiceImage(file) {
  if (file.size > 20_000_000) throw new Error("照片不能超過 20 MB");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => { throw new Error("無法讀取照片，請改用 JPEG、PNG 或 WebP"); });
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.88);
    if (image.length > 5_333_360) throw new Error("照片壓縮後仍超過 4 MB，請裁剪後重試");
    return image;
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
    preview.hidden = false;
    const warnings = $("#invoice-warnings", form);
    warnings.replaceChildren(...result.warnings.map((message) => {
      const li = document.createElement("li");
      li.textContent = message;
      return li;
    }));
    warnings.hidden = !result.warnings.length;
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

function closeModal() {
  cancelInvoiceOCR();
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
  const config = forms[form.dataset.formType];
  const raw = Object.fromEntries(new FormData(form));
  const payload = config.transform ? config.transform(raw) : raw;
  const button = $("button[type=submit]", form);
  state.submitting = true;
  button.disabled = true;
  button.textContent = "正在儲存…";
  try {
    await api(form.dataset.endpoint, { method: form.dataset.method, body: JSON.stringify(payload) });
    closeModal();
    toast(form.dataset.success);
    await loadDashboard({ quiet: true });
    if ($("#admin-view") && !$("#admin-view").hidden) {
      await loadAdminTable(adminState.currentTable);
      await loadAdminOverview();
    }
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
    button.textContent = "再試一次";
  } finally {
    state.submitting = false;
  }
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
            ${cat.is_default ? "" : `<button type="button" class="icon-button delete" data-admin-delete="categories" data-id="${esc(cat.key)}" title="刪除分類">${icon("trash")}</button>`}
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
  let confirmMsg = `確定要刪除這筆資料嗎？`;
  if (table === "categories") {
    confirmMsg = `確定要刪除自訂分類「${idOrKey}」嗎？\n\n注意：原先使用此分類的開支與購物項目會自動轉移至「其他」，不會遺失。`;
  } else if (table === "settings") {
    confirmMsg = `確定要刪除系統參數「${idOrKey}」嗎？`;
  }
  if (!window.confirm(confirmMsg)) return;

  try {
    if (table === "categories") {
      await api(`/api/categories/${encodeURIComponent(idOrKey)}`, { method: "DELETE" });
    } else if (table === "settings") {
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
      $("#moments")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return toast("最近的特別日子都在這裡");
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
bindEvents();
loadDashboard().then(() => {
  if (location.hash === "#admin" || location.hash === "#params") {
    switchView("admin");
  }
});
