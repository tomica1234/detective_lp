(() => {
  "use strict";

  const STORAGE_KEY = "worklog.records.v1";
  const SETTINGS_KEY = "worklog.settings.v1";
  const ACCOUNTS_KEY = "worklog.accounts.v1";
  const CURRENT_ACCOUNT_KEY = "worklog.currentAccount.v1";
  const categoryGroups = {
    "探偵": ["調査", "張り込み・尾行", "報告書作成", "打ち合わせ", "事務", "その他"],
    "LLM": ["開発・制作", "検証・評価", "資料作成", "調査・分析", "打ち合わせ", "その他"],
  };
  const majorCategories = Object.keys(categoryGroups);
  const $ = (selector) => document.querySelector(selector);
  let accounts = loadAccounts();

  function readJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function accountRecordsKey(accountId) { return `worklog.account.${accountId}.records.v1`; }
  function accountSettingsKey(accountId) { return `worklog.account.${accountId}.settings.v1`; }

  function loadAccounts() {
    const stored = readJSON(ACCOUNTS_KEY, []);
    return Array.isArray(stored) ? stored.filter((account) => account && account.id && account.name).map((account, index) => ({ ...account, role: account.role || (index === 0 ? "admin" : "user") })) : [];
  }

  function normalizeRecords(records, accountId, accountName) {
    return (Array.isArray(records) ? records : []).filter((record) => record && record.id && record.start).map((record) => ({
      ...record,
      majorCategory: record.majorCategory || (record.category?.includes(" / ") ? record.category.split(" / ")[0] : ""),
      minorCategory: record.minorCategory || (record.category?.includes(" / ") ? record.category.split(" / ").slice(1).join(" / ") : ""),
      accountId: record.accountId || accountId,
      accountName: record.accountName || accountName,
    }));
  }

  function ensureAccountStore() {
    if (!accounts.length) {
      const legacyRecords = readJSON(STORAGE_KEY, []);
      const legacySettings = readJSON(SETTINGS_KEY, {});
      const defaultAccount = { id: "account-default", name: "自分", role: "admin", createdAt: new Date().toISOString() };
      accounts = [defaultAccount];
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
      localStorage.setItem(accountRecordsKey(defaultAccount.id), JSON.stringify(normalizeRecords(legacyRecords, defaultAccount.id, defaultAccount.name)));
      localStorage.setItem(accountSettingsKey(defaultAccount.id), JSON.stringify(legacySettings));
    }
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    const storedCurrent = localStorage.getItem(CURRENT_ACCOUNT_KEY);
    return accounts.some((account) => account.id === storedCurrent) ? storedCurrent : accounts[0].id;
  }

  const initialAccountId = ensureAccountStore();
  const initialAccount = accounts.find((account) => account.id === initialAccountId) || accounts[0];
  const state = {
    accountId: initialAccount.id,
    accountName: initialAccount.name,
    records: normalizeRecords(readJSON(accountRecordsKey(initialAccount.id), []), initialAccount.id, initialAccount.name),
    settings: { syncUrl: "", syncToken: "", ...readJSON(accountSettingsKey(initialAccount.id), {}) },
    period: "month",
    majorFilter: "all",
    minorFilter: "all",
  };

  function saveRecords() {
    localStorage.setItem(accountRecordsKey(state.accountId), JSON.stringify(state.records));
  }

  function saveSettings() {
    localStorage.setItem(accountSettingsKey(state.accountId), JSON.stringify(state.settings));
  }

  function saveAccounts() {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  function currentAccount() {
    return accounts.find((account) => account.id === state.accountId) || accounts[0];
  }

  function accountInitial(name) {
    return String(name || "自").trim().slice(0, 1) || "自";
  }

  function renderAccountUi() {
    const account = currentAccount();
    if (!account) return;
    $("#account-avatar").textContent = accountInitial(account.name);
    $("#account-name").textContent = account.name;
    $("#account-modal-current").textContent = account.name;
    $("#account-avatar-large").textContent = accountInitial(account.name);
    $("#account-modal-role").textContent = account.role === "admin" ? "管理者" : "一般";
    $("#create-account-section").classList.toggle("hidden", account.role !== "admin");
    const select = $("#account-select");
    select.innerHTML = accounts.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join("");
    select.value = state.accountId;
  }

  function openAccountModal() {
    renderAccountUi();
    $("#new-account-name").value = "";
    $("#account-message").textContent = "";
    $("#account-message").classList.remove("error");
    $("#account-modal").classList.remove("hidden");
  }

  function closeAccountModal() { $("#account-modal").classList.add("hidden"); }

  function setAccountMessage(message, isError = false) {
    const target = $("#account-message");
    target.textContent = message;
    target.classList.toggle("error", isError);
  }

  function switchAccount() {
    const nextId = $("#account-select").value;
    if (!nextId || nextId === state.accountId) {
      closeAccountModal();
      return;
    }
    saveRecords();
    saveSettings();
    const nextAccount = accounts.find((account) => account.id === nextId);
    if (!nextAccount) return;
    state.accountId = nextAccount.id;
    state.accountName = nextAccount.name;
    state.records = normalizeRecords(readJSON(accountRecordsKey(nextAccount.id), []), nextAccount.id, nextAccount.name);
    state.settings = { syncUrl: "", syncToken: "", ...readJSON(accountSettingsKey(nextAccount.id), {}) };
    state.period = "month";
    state.majorFilter = "all";
    state.minorFilter = "all";
    localStorage.setItem(CURRENT_ACCOUNT_KEY, state.accountId);
    resetForm();
    render();
    closeAccountModal();
    showToast(`${nextAccount.name}に切り替えました`);
  }

  function createAccount() {
    if (currentAccount().role !== "admin") {
      setAccountMessage("アカウントの追加は管理者のみ行えます。", true);
      return;
    }
    const name = $("#new-account-name").value.trim();
    if (!name) {
      setAccountMessage("アカウント名を入力してください。", true);
      return;
    }
    if (accounts.some((account) => account.name === name)) {
      setAccountMessage("同じ名前のアカウントがすでにあります。", true);
      return;
    }
    const account = { id: `account-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: name.slice(0, 30), role: "user", createdAt: new Date().toISOString() };
    accounts.push(account);
    saveAccounts();
    localStorage.setItem(accountRecordsKey(account.id), "[]");
    localStorage.setItem(accountSettingsKey(account.id), JSON.stringify({ syncUrl: "", syncToken: "" }));
    $("#account-select").value = account.id;
    setAccountMessage(`${account.name}を追加しました。切り替えると、このアカウントで記録できます。`);
    renderAccountUi();
    $("#account-select").value = account.id;
  }

  function isAdmin() {
    return currentAccount()?.role === "admin";
  }

  function accountRecords(account) {
    return normalizeRecords(readJSON(accountRecordsKey(account.id), []), account.id, account.name);
  }

  function renderAdminUi() {
    const adminButton = $("#open-admin");
    adminButton.classList.toggle("hidden", !isAdmin());
    if (!isAdmin()) return;
    const recordsByAccount = accounts.map((account) => ({ account, records: accountRecords(account) }));
    $("#admin-account-count").textContent = accounts.length;
    $("#admin-record-count").textContent = recordsByAccount.reduce((sum, item) => sum + item.records.length, 0);
    $("#admin-total-hours").textContent = formatDuration(recordsByAccount.reduce((sum, item) => sum + item.records.reduce((recordTotal, record) => recordTotal + durationMinutes(record), 0), 0));
    $("#admin-account-list").innerHTML = recordsByAccount.map(({ account, records }) => `<div class="admin-account-row"><div class="admin-account-main"><span class="avatar admin-avatar">${escapeHTML(accountInitial(account.name))}</span><div><strong>${escapeHTML(account.name)}</strong><span>${account.id === state.accountId ? "現在のアカウント · " : ""}${records.length}件</span></div></div><div class="admin-account-actions"><span class="role-badge ${account.role === "admin" ? "admin" : "user"}">${account.role === "admin" ? "管理者" : "一般"}</span><button class="row-button" data-admin-action="toggle-role" data-id="${escapeHTML(account.id)}">${account.role === "admin" ? "一般にする" : "管理者にする"}</button></div></div>`).join("");
  }

  function openAdminModal() {
    if (!isAdmin()) return;
    renderAdminUi();
    $("#admin-message").textContent = "";
    $("#admin-modal").classList.remove("hidden");
  }

  function closeAdminModal() { $("#admin-modal").classList.add("hidden"); }

  function toggleAccountRole(id) {
    if (!isAdmin()) return;
    const target = accounts.find((account) => account.id === id);
    if (!target) return;
    if (target.role === "admin" && accounts.filter((account) => account.role === "admin").length <= 1) {
      $("#admin-message").textContent = "管理者は1人以上必要です。";
      return;
    }
    target.role = target.role === "admin" ? "user" : "admin";
    saveAccounts();
    if (target.id === state.accountId && target.role !== "admin") {
      render();
      closeAdminModal();
      return;
    }
    renderAdminUi();
    renderAccountUi();
    $("#admin-message").textContent = `${target.name}の権限を変更しました。`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function pad(number) { return String(number).padStart(2, "0"); }

  function localDateTimeValue(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function parseLocal(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function monthKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`; }
  function dayKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function currentMonthKey() { return monthKey(new Date()); }

  function formatDate(date, includeWeekday = true) {
    if (!date) return "—";
    return new Intl.DateTimeFormat("ja-JP", includeWeekday ? { month: "numeric", day: "numeric", weekday: "short" } : { month: "numeric", day: "numeric" }).format(date);
  }

  function formatDateTime(value) {
    const date = parseLocal(value);
    if (!date) return "—";
    return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatMonth(date = new Date()) {
    return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" }).format(date);
  }

  function displayCategory(record) {
    if (record.majorCategory && record.minorCategory) return `${record.majorCategory} / ${record.minorCategory}`;
    return record.category || record.minorCategory || "未分類";
  }

  function minorCategoriesFor(majorCategory) {
    return categoryGroups[majorCategory] || [];
  }

  function renderMinorCategoryOptions(selected = "") {
    const major = $("#major-category").value;
    const minor = $("#minor-category");
    const options = minorCategoriesFor(major);
    minor.disabled = !major;
    minor.innerHTML = `<option value="">${major ? "小分類を選択してください" : "先に大分類を選択してください"}</option>${options.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join("")}`;
    minor.value = options.includes(selected) ? selected : "";
  }

  function durationMinutes(record) {
    const start = parseLocal(record.start);
    const end = parseLocal(record.end) || new Date();
    if (!start) return 0;
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  }

  function formatDuration(minutes, withUnits = false) {
    const safeMinutes = Math.max(0, Math.round(minutes || 0));
    const hours = Math.floor(safeMinutes / 60);
    const remaining = safeMinutes % 60;
    return withUnits ? `${hours}時間${pad(remaining)}分` : `${hours}h ${pad(remaining)}m`;
  }

  function formatKPI(minutes) {
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return `${hours}<span class="unit">時間</span><small>${pad(remaining)}分</small>`;
  }

  function sortedRecords(records = state.records) {
    return [...records].sort((a, b) => (parseLocal(b.start)?.getTime() || 0) - (parseLocal(a.start)?.getTime() || 0));
  }

  function monthRecords() {
    const key = currentMonthKey();
    return state.records.filter((record) => {
      const start = parseLocal(record.start);
      return start && monthKey(start) === key;
    });
  }

  function setNow(targetId) {
    const input = document.getElementById(targetId);
    if (input) {
      input.value = localDateTimeValue();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function resetForm() {
    $("#editing-id").value = "";
    $("#start-at").value = localDateTimeValue();
    $("#end-at").value = "";
    $("#major-category").value = "";
    renderMinorCategoryOptions();
    $("#description").value = "";
    $("#submit-label").textContent = "記録を保存する";
    $("#form-message").textContent = "";
  }

  function showFormMessage(message) { $("#form-message").textContent = message; }

  function render() {
    renderAccountUi();
    renderAdminUi();
    renderHeader();
    renderKpis();
    renderRecent();
    renderFilters();
    renderTable();
    renderAnalysis();
    updateSyncUi();
  }

  function renderHeader() {
    const now = new Date();
    $("#kpi-month").textContent = formatMonth(now);
    $("#analysis-period").textContent = formatMonth(now);
  }

  function renderKpis() {
    const records = monthRecords();
    const total = records.reduce((sum, record) => sum + durationMinutes(record), 0);
    const days = new Set(records.map((record) => { const date = parseLocal(record.start); return date ? dayKey(date) : null; }).filter(Boolean));
    const byCategory = groupByCategory(records);
    const top = byCategory[0];
    $("#month-total").innerHTML = formatKPI(total);
    $("#month-count").innerHTML = `${records.length}<span class="unit">件</span>`;
    $("#daily-average").innerHTML = formatKPI(days.size ? Math.round(total / days.size) : 0);
    $("#month-days").textContent = days.size ? `${days.size}日稼働` : "—";
    $("#top-category").textContent = top ? top[0] : "—";
    $("#top-category-hours").textContent = top ? `${formatDuration(top[1], true)}（全体の${Math.round(top[1] / Math.max(1, total) * 100)}%）` : "—";
  }

  function groupByCategory(records) {
    const totals = new Map();
    records.forEach((record) => {
      const label = displayCategory(record);
      totals.set(label, (totals.get(label) || 0) + durationMinutes(record));
    });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }

  function renderRecent() {
    const container = $("#recent-records");
    const records = sortedRecords().slice(0, 5);
    $("#show-all-records").classList.toggle("hidden", records.length === 0);
    if (!records.length) {
      container.innerHTML = `<div class="empty-small"><div class="empty-icon">◷</div><div>記録なし</div></div>`;
      return;
    }
    container.innerHTML = records.map((record) => {
      const date = parseLocal(record.start);
      const title = record.description || displayCategory(record);
      return `<div class="recent-item"><div class="date-chip"><strong>${date ? date.getDate() : "—"}</strong><span>${date ? date.toLocaleDateString("ja-JP", { month: "short" }) : ""}</span></div><div class="recent-main"><div class="recent-title">${escapeHTML(title)}</div><div class="recent-meta"><span class="category-pill">${escapeHTML(displayCategory(record))}</span><span>${formatDateTime(record.start)}〜</span></div></div><div class="recent-duration ${record.end ? "" : "open"}">${record.end ? formatDuration(durationMinutes(record)) : "稼働中"}</div></div>`;
    }).join("");
  }

  function renderFilters() {
    const majorFilter = $("#major-filter");
    majorFilter.innerHTML = `<option value="all">全大分類</option>${majorCategories.map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join("")}`;
    majorFilter.value = state.majorFilter;
    const minorFilter = $("#minor-filter");
    const filterMinorOptions = state.majorFilter === "all" ? [...new Set(Object.values(categoryGroups).flat())] : minorCategoriesFor(state.majorFilter);
    minorFilter.innerHTML = `<option value="all">全小分類</option>${filterMinorOptions.map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join("")}`;
    minorFilter.value = state.minorFilter;
    $("#period-filter").value = state.period;
  }

  function filteredRecords() {
    return sortedRecords().filter((record) => {
      const date = parseLocal(record.start);
      const matchesPeriod = state.period === "all" || (date && monthKey(date) === currentMonthKey());
      const matchesMajor = state.majorFilter === "all" || record.majorCategory === state.majorFilter;
      const matchesMinor = state.minorFilter === "all" || record.minorCategory === state.minorFilter;
      return matchesPeriod && matchesMajor && matchesMinor;
    });
  }

  function renderTable() {
    const records = filteredRecords();
    const body = $("#records-body");
    $("#records-empty").classList.toggle("hidden", records.length > 0);
    if (!records.length) {
      body.innerHTML = "";
      return;
    }
    body.innerHTML = records.map((record) => `<tr><td class="record-date">${formatDateTime(record.start)}</td><td class="record-date">${record.end ? formatDateTime(record.end) : `<span class="record-state"><span class="status-dot"></span>稼働中</span>`}</td><td><span class="category-pill">${escapeHTML(displayCategory(record))}</span></td><td class="record-description" title="${escapeHTML(record.description || "")}">${escapeHTML(record.description || "—")}</td><td class="record-date">${formatDuration(durationMinutes(record))}</td><td><div class="row-actions">${record.end ? "" : `<button class="row-button finish" data-action="finish" data-id="${escapeHTML(record.id)}">終了</button>`}<button class="row-button" data-action="edit" data-id="${escapeHTML(record.id)}">編集</button><button class="row-button" data-action="delete" data-id="${escapeHTML(record.id)}">削除</button></div></td></tr>`).join("");
  }

  function renderAnalysis() {
    const records = monthRecords();
    const grouped = groupByCategory(records);
    const max = grouped.length ? grouped[0][1] : 0;
    $("#category-bars").innerHTML = grouped.length ? grouped.map(([category, minutes]) => `<div class="bar-row"><div class="bar-label" title="${escapeHTML(category)}">${escapeHTML(category)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round(minutes / max * 100))}%"></div></div><div class="bar-time">${formatDuration(minutes)}</div></div>`).join("") : `<div class="empty-small">データなし</div>`;
    renderInsight(records, grouped);
    renderDailyChart(records);
  }

  function renderInsight(records, grouped) {
    const target = $("#insight-content");
    if (!records.length) {
      target.innerHTML = `<div class="empty-small">データなし</div>`;
      return;
    }
    const [topCategory, topMinutes] = grouped[0];
    const total = records.reduce((sum, record) => sum + durationMinutes(record), 0);
    const openCount = records.filter((record) => !record.end).length;
    const ratio = Math.round(topMinutes / Math.max(1, total) * 100);
    const detail = openCount ? `現在進行中の記録が${openCount}件あります。` : `${records.length}件の記録をもとに集計しています。`;
    target.innerHTML = `<div class="insight-mark">✦</div><p class="insight-text">今月は <strong>${escapeHTML(topCategory)}</strong> に<br><strong>${formatDuration(topMinutes, true)}</strong> 使っています。</p><p class="insight-detail">全体の${ratio}%を占めています。${detail}</p>`;
  }

  function renderDailyChart(records) {
    const target = $("#daily-chart");
    if (!records.length) {
      target.innerHTML = `<div class="chart-empty">データなし</div>`;
      return;
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const values = Array.from({ length: daysInMonth }, (_, index) => {
      const dateKey = `${year}-${pad(month + 1)}-${pad(index + 1)}`;
      return records.filter((record) => record.start.slice(0, 10) === dateKey).reduce((sum, record) => sum + durationMinutes(record), 0);
    });
    const max = Math.max(60, ...values);
    const width = 720;
    const height = 194;
    const chartLeft = 34;
    const chartRight = 8;
    const chartTop = 15;
    const chartBottom = 29;
    const chartWidth = width - chartLeft - chartRight;
    const chartHeight = height - chartTop - chartBottom;
    const gap = Math.max(2, Math.min(7, chartWidth / daysInMonth * .25));
    const barWidth = Math.max(4, (chartWidth / daysInMonth) - gap);
    const grids = [0, .5, 1].map((ratio) => {
      const y = chartTop + chartHeight - ratio * chartHeight;
      const label = ratio === 0 ? "0h" : `${Math.round(max * ratio / 60)}h`;
      return `<line class="chart-grid-line" x1="${chartLeft}" y1="${y}" x2="${width}" y2="${y}"/><text class="chart-axis-label" x="0" y="${y + 4}">${label}</text>`;
    }).join("");
    const bars = values.map((minutes, index) => {
      const x = chartLeft + index * (chartWidth / daysInMonth) + gap / 2;
      const barHeight = minutes ? Math.max(3, minutes / max * chartHeight) : 0;
      const y = chartTop + chartHeight - barHeight;
      const isToday = index + 1 === now.getDate();
      const label = index % (daysInMonth > 20 ? 5 : 3) === 0 || index === daysInMonth - 1 ? `<text class="chart-x-label" text-anchor="middle" x="${x + barWidth / 2}" y="${height - 7}">${index + 1}</text>` : "";
      const totalLabel = minutes >= 60 ? `<text class="chart-total-label" text-anchor="middle" x="${x + barWidth / 2}" y="${Math.max(10, y - 5)}">${Math.round(minutes / 60 * 10) / 10}</text>` : "";
      return `${minutes ? `<rect class="chart-bar ${isToday ? "today" : ""}" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3"><title>${index + 1}日: ${formatDuration(minutes, true)}</title></rect>${totalLabel}` : ""}${label}`;
    }).join("");
    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="今月の日別稼働時間グラフ">${grids}${bars}</svg>`;
  }

  function editRecord(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;
    $("#editing-id").value = record.id;
    $("#start-at").value = record.start;
    $("#end-at").value = record.end || "";
    $("#major-category").value = record.majorCategory || "";
    renderMinorCategoryOptions(record.minorCategory || "");
    $("#description").value = record.description || "";
    $("#submit-label").textContent = "変更を保存する";
    showFormMessage("");
    $("#log-form").scrollIntoView({ behavior: "smooth", block: "center" });
    $("#start-at").focus();
  }

  function finishRecord(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;
    record.end = localDateTimeValue();
    record.updatedAt = new Date().toISOString();
    saveRecords();
    render();
    showToast("稼働を終了しました");
    syncRecord(record);
  }

  function deleteRecord(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;
    if (!window.confirm("この記録を削除しますか？")) return;
    state.records = state.records.filter((item) => item.id !== id);
    saveRecords();
    render();
    showToast("記録を削除しました");
    deleteRemoteRecord(id);
  }

  function recordForSync(record) {
    return { ...record, accountId: state.accountId, accountName: state.accountName };
  }

  async function syncRecord(record) {
    if (!state.settings.syncUrl) return;
    try { await sendToSheet({ action: "upsert", record: recordForSync(record), token: state.settings.syncToken }); } catch (error) { /* 次回の手動同期で再試行 */ }
  }

  async function deleteRemoteRecord(id) {
    if (!state.settings.syncUrl) return;
    try { await sendToSheet({ action: "delete", id, accountId: state.accountId, token: state.settings.syncToken }); } catch (error) { /* 次回の手動同期で再試行 */ }
  }

  function submitForm(event) {
    event.preventDefault();
    const start = $("#start-at").value;
    const end = $("#end-at").value;
    const majorCategory = $("#major-category").value;
    const minorCategory = $("#minor-category").value;
    if (!start || !majorCategory || !minorCategory) { showFormMessage("開始時刻、大分類、小分類を入力してください。"); return; }
    if (end && parseLocal(end) <= parseLocal(start)) { showFormMessage("終了時刻は開始時刻より後にしてください。"); return; }
    const editingId = $("#editing-id").value;
    const now = new Date().toISOString();
    const record = { id: editingId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, start, end, majorCategory, minorCategory, category: `${majorCategory} / ${minorCategory}`, description: $("#description").value.trim(), updatedAt: now };
    if (editingId) {
      state.records = state.records.map((item) => item.id === editingId ? { ...item, ...record } : item);
    } else {
      state.records.push({ ...record, createdAt: now });
    }
    saveRecords();
    render();
    resetForm();
    showToast(editingId ? "記録を更新しました" : end ? "稼働を記録しました" : "稼働中として保存しました");
    syncRecord(record);
  }

  function openSettings() {
    $("#sync-url").value = state.settings.syncUrl;
    $("#sync-token").value = state.settings.syncToken;
    $("#sync-feedback").textContent = "";
    $("#sync-feedback").classList.remove("error");
    $("#settings-modal").classList.remove("hidden");
    setTimeout(() => $("#sync-url").focus(), 50);
  }

  function closeSettings() { $("#settings-modal").classList.add("hidden"); }

  function saveSettingsFromModal() {
    state.settings.syncUrl = $("#sync-url").value.trim().replace(/\/$/, "");
    state.settings.syncToken = $("#sync-token").value.trim();
    saveSettings();
    updateSyncUi();
    setSyncFeedback("連携設定を保存しました。", false);
    showToast(state.settings.syncUrl ? "Sheets連携を設定しました" : "Sheets連携を解除しました");
  }

  function updateSyncUi(syncing = false) {
    const connected = Boolean(state.settings.syncUrl);
    const dotClasses = syncing ? "status-dot syncing" : connected ? "status-dot connected" : "status-dot";
    $("#sync-status").innerHTML = `<span class="${dotClasses}"></span><span id="sync-status-label">${syncing ? "同期中…" : connected ? "Sheets連携済み" : "ローカル保存中"}</span>`;
    $("#sidebar-sync-label").textContent = connected ? "Sheets連携済み" : "Sheets未接続";
    $("#sidebar-sync-card").querySelector(".status-dot").className = dotClasses;
  }

  function setSyncFeedback(message, isError) {
    const feedback = $("#sync-feedback");
    feedback.textContent = message;
    feedback.classList.toggle("error", isError);
  }

  async function sendToSheet(payload) {
    if (!state.settings.syncUrl) throw new Error("sync url is empty");
    const request = { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) };
    try {
      const response = await fetch(state.settings.syncUrl, request);
      if (response.type === "opaque") return { ok: true, count: payload.records?.length || 1 };
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch (error) { result = { ok: response.ok }; }
      if (!response.ok || result.ok === false) {
        const serverError = new Error(result.error || "同期に失敗しました");
        serverError.fromServer = true;
        throw serverError;
      }
      return result;
    } catch (error) {
      // Apps ScriptのレスポンスにCORSヘッダーがない環境でも、書き込み自体は受け付けられるようにする。
      if (error.fromServer) throw error;
      await fetch(state.settings.syncUrl, { ...request, mode: "no-cors" });
      return { ok: true, count: payload.records?.length || 1 };
    }
  }

  async function syncNow() {
    if (!state.settings.syncUrl) { openSettings(); setSyncFeedback("先にWebアプリURLを設定してください。", true); return; }
    updateSyncUi(true);
    setSyncFeedback("スプレッドシートへ送信しています…", false);
    try {
      const result = await sendToSheet({ action: "bulkUpsert", records: state.records.map(recordForSync), token: state.settings.syncToken });
      state.settings.lastSyncedAt = new Date().toISOString();
      saveSettings();
      updateSyncUi();
      setSyncFeedback(`${result.count ?? state.records.length}件を同期しました。`, false);
      showToast("スプレッドシートと同期しました");
    } catch (error) {
      updateSyncUi();
      setSyncFeedback(`同期できませんでした：${error.message}`, true);
    }
  }

  async function pullFromSheet() {
    if (!state.settings.syncUrl) { setSyncFeedback("先にWebアプリURLを設定してください。", true); return; }
    setSyncFeedback("シートから読み込んでいます…", false);
    try {
      const query = new URL(state.settings.syncUrl);
      query.searchParams.set("action", "list");
      if (state.settings.syncToken) query.searchParams.set("token", state.settings.syncToken);
      query.searchParams.set("t", Date.now());
      let result;
      try {
        const response = await fetch(query.toString());
        if (!response.ok) throw new Error("取得に失敗しました");
        result = await response.json();
      } catch (error) {
        result = await jsonpRequest(query.toString());
      }
      if (result.ok === false) throw new Error(result.error || "取得に失敗しました");
      const remoteRecords = (result.records || []).filter((remote) => !remote.accountId || remote.accountId === state.accountId);
      const localById = new Map(state.records.map((record) => [record.id, record]));
      remoteRecords.forEach((remote) => {
        const local = localById.get(remote.id);
        if (!local || (remote.updatedAt || "") >= (local.updatedAt || "")) localById.set(remote.id, { ...remote, accountId: state.accountId, accountName: state.accountName });
      });
      state.records = [...localById.values()];
      saveRecords();
      render();
      setSyncFeedback(`${remoteRecords.length}件を取り込みました。`, false);
      showToast("シートの記録を取り込みました");
    } catch (error) {
      setSyncFeedback(`取得できませんでした：${error.message}`, true);
    }
  }

  function jsonpRequest(url) {
    return new Promise((resolve, reject) => {
      const callbackName = `worklogCallback_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const script = document.createElement("script");
      const cleanup = () => { delete window[callbackName]; script.remove(); };
      window[callbackName] = (result) => { cleanup(); resolve(result); };
      script.onerror = () => { cleanup(); reject(new Error("シートから取得できませんでした")); };
      script.src = `${url}&callback=${encodeURIComponent(callbackName)}`;
      document.head.appendChild(script);
    });
  }

  function exportCSV() {
    const header = ["ID", "稼働開始", "稼働終了", "大分類", "小分類", "内容記述", "稼働時間（分）"];
    const rows = filteredRecords().map((record) => [record.id, record.start, record.end || "", record.majorCategory || "", record.minorCategory || "", record.description || "", durationMinutes(record)]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `worklog-${currentMonthKey()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("CSVを書き出しました");
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function bindEvents() {
    $("#worklog-form").addEventListener("submit", submitForm);
    $("#reset-form").addEventListener("click", resetForm);
    $("#scroll-to-form").addEventListener("click", () => $("#log-form").scrollIntoView({ behavior: "smooth", block: "center" }));
    $("#show-all-records").addEventListener("click", () => { $("#all-records-panel").classList.remove("hidden"); $("#all-records-panel").scrollIntoView({ behavior: "smooth", block: "center" }); });
    $("#period-filter").addEventListener("change", (event) => { state.period = event.target.value; renderTable(); });
    $("#major-category").addEventListener("change", () => renderMinorCategoryOptions());
    $("#major-filter").addEventListener("change", (event) => { state.majorFilter = event.target.value; state.minorFilter = "all"; renderFilters(); renderTable(); });
    $("#minor-filter").addEventListener("change", (event) => { state.minorFilter = event.target.value; renderTable(); });
    $("#export-csv").addEventListener("click", exportCSV);
    document.querySelectorAll("[data-now-target]").forEach((button) => button.addEventListener("click", () => setNow(button.dataset.nowTarget)));
    $("#records-body").addEventListener("click", (event) => { const button = event.target.closest("[data-action]"); if (!button) return; const { action, id } = button.dataset; if (action === "edit") editRecord(id); if (action === "finish") finishRecord(id); if (action === "delete") deleteRecord(id); });
    ["#open-settings", "#open-settings-from-sidebar", "#open-settings-footer"].forEach((selector) => $(selector).addEventListener("click", openSettings));
    $("#open-account").addEventListener("click", openAccountModal);
    $("#open-admin").addEventListener("click", openAdminModal);
    $("#close-account").addEventListener("click", closeAccountModal);
    $("#account-modal").addEventListener("click", (event) => { if (event.target.id === "account-modal") closeAccountModal(); });
    $("#switch-account").addEventListener("click", switchAccount);
    $("#create-account").addEventListener("click", createAccount);
    $("#close-admin").addEventListener("click", closeAdminModal);
    $("#admin-modal").addEventListener("click", (event) => { if (event.target.id === "admin-modal") closeAdminModal(); });
    $("#admin-account-list").addEventListener("click", (event) => { const button = event.target.closest("[data-admin-action]"); if (button?.dataset.adminAction === "toggle-role") toggleAccountRole(button.dataset.id); });
    $("#close-settings").addEventListener("click", closeSettings);
    $("#settings-modal").addEventListener("click", (event) => { if (event.target.id === "settings-modal") closeSettings(); });
    $("#save-settings").addEventListener("click", saveSettingsFromModal);
    $("#sync-now").addEventListener("click", async () => { saveSettingsFromModal(); await syncNow(); });
    $("#pull-from-sheet").addEventListener("click", async () => { saveSettingsFromModal(); await pullFromSheet(); });
    document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => { document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active")); link.classList.add("active"); }));
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!$("#settings-modal").classList.contains("hidden")) closeSettings();
      if (!$("#account-modal").classList.contains("hidden")) closeAccountModal();
      if (!$("#admin-modal").classList.contains("hidden")) closeAdminModal();
    });
  }

  resetForm();
  bindEvents();
  render();
})();
