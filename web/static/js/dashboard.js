(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = { jobs: [], selectedJob: null, rows: [], filtered: [], page: 1, pageSize: 50, sortKey: "quality", sortDir: -1 };
  const columnLabels = { quality: "Lead score", title: "Business", category: "Category", address: "Address", phone: "Phone", emails: "Email", website: "Website", review_rating: "Rating", review_count: "Reviews", lead_type: "Ownership signal", contact_gap: "Next action", status: "Status" };
  const defaultColumns = ["quality", "title", "category", "address", "phone", "emails", "website", "review_rating", "review_count"];
  let visibleColumns = [...defaultColumns];
  let toastTimer;
  let jobsSignature = "";

  const presets = {
    quick: { depth: 1, time: "5m", email: false, fast: false },
    standard: { depth: 10, time: "10m", email: false, fast: false },
    enriched: { depth: 10, time: "20m", email: true, fast: false },
    large: { depth: 30, time: "30m", email: false, fast: false }
  };

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 2800);
  }

  function setHealth(ok, text) {
    $("#healthDot").className = `health-dot ${ok ? "ok" : "bad"}`;
    $("#healthText").textContent = text;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown time" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  }

  function durationMs(value) {
    if (typeof value === "number") return value / 1e6;
    const match = String(value || "").match(/([\d.]+)(m|s|h)/);
    if (!match) return 600000;
    return Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000 }[match[2]]);
  }

  function progressFor(job) {
    if (job.Status === "ok") return 100;
    if (job.Status === "failed") return 100;
    if (job.Status === "pending") return 4;
    const elapsed = Date.now() - new Date(job.Date).getTime();
    return Math.max(8, Math.min(94, Math.round((elapsed / durationMs(job.Data?.max_time)) * 100)));
  }

  function statusLabel(status) {
    return ({ ok: "Complete", working: "Working", pending: "Queued", failed: "Failed" })[status] || status;
  }

  function renderJobs() {
    const list = $("#jobList");
    if (!state.jobs.length) {
      list.innerHTML = '<div class="empty-state"><div><strong>No discovery runs yet</strong><p>Choose a place type and market to build your first local dataset.</p></div></div>';
      return;
    }
    list.innerHTML = state.jobs.map((job, index) => {
      const progress = progressFor(job);
      const queries = (job.Data?.keywords || []).join(" · ");
      const open = job.Status === "ok" ? `<button class="open-button" data-open="${escapeHTML(job.ID)}">Open results</button>` : `<span class="status ${escapeHTML(job.Status)}">${escapeHTML(statusLabel(job.Status))}</span>`;
      return `<article class="job-item status-${escapeHTML(job.Status)}" style="animation-delay:${Math.min(index * 35, 180)}ms">
        <div class="job-title"><h3>${escapeHTML(job.Name)}</h3><p>${escapeHTML(queries)} · ${escapeHTML(formatDate(job.Date))}</p></div>
        <div class="job-progress"><small><span>${escapeHTML(statusLabel(job.Status))}</span><span>${progress}%</span></small><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div></div>
        <div class="job-actions">${open}<button class="icon-button" data-delete="${escapeHTML(job.ID)}" title="Delete search" aria-label="Delete ${escapeHTML(job.Name)}">×</button></div>
      </article>`;
    }).join("");
  }

  async function loadJobs(showFeedback = false) {
    try {
      const response = await fetch("/api/v1/jobs", { cache: "no-store" });
      if (!response.ok) throw new Error(`Engine returned ${response.status}`);
      const payload = await response.json();
      const jobs = (Array.isArray(payload) ? payload : []).sort((a, b) => new Date(b.Date) - new Date(a.Date));
      const nextSignature = JSON.stringify(jobs);
      state.jobs = jobs;
      if (nextSignature !== jobsSignature) {
        jobsSignature = nextSignature;
        renderJobs();
      }
      setHealth(true, "Engine ready");
      if (showFeedback) toast("Discovery runs refreshed");
    } catch (error) {
      setHealth(false, "Engine unavailable");
      $("#jobList").innerHTML = `<div class="empty-state"><div><strong>Cannot reach the scraper</strong><p>${escapeHTML(error.message)}. Make sure Docker Desktop is running, then refresh.</p></div></div>`;
    }
  }

  function applyPreset(name) {
    const preset = presets[name];
    if (!preset) return;
    $("#depth").value = preset.depth;
    $("#maxTime").value = preset.time;
    $("#fetchEmails").checked = preset.email;
    $("#fastMode").checked = preset.fast;
    $$(".preset").forEach((button) => button.classList.toggle("active", button.dataset.preset === name));
    updateSettingsSummary();
    if (name === "large" && !$("#proxies").value.trim()) toast("Large searches work best with proxies");
  }

  function updateSettingsSummary() {
    $("#settingsSummary").textContent = `Depth ${$("#depth").value} · ${$("#maxTime").selectedOptions[0].text.toLowerCase()}${$("#fetchEmails").checked ? " · emails" : ""}`;
  }

  function validateForm() {
    $$(".invalid").forEach((node) => node.classList.remove("invalid"));
    $$(".field-error").forEach((node) => node.textContent = "");
    const errors = [];
    const required = [["businessType", "Enter anything you want to find on Google Maps."], ["location", "Enter a city, ZIP, region, neighborhood, or country."]];
    required.forEach(([id, message]) => {
      if (!$("#" + id).value.trim()) {
        $("#" + id).classList.add("invalid");
        $(`[data-error-for="${id}"]`).textContent = message;
        errors.push(message);
      }
    });
    if (!/^[a-z]{2}$/i.test($("#language").value.trim())) errors.push("Language must be a two-letter code such as en.");
    if ($("#fastMode").checked && (Number($("#latitude").value) === 0 || Number($("#longitude").value) === 0)) errors.push("Fast mode needs real latitude and longitude coordinates.");
    const message = $("#formMessage");
    message.textContent = errors[0] || "";
    message.classList.toggle("show", errors.length > 0);
    return errors.length === 0;
  }

  async function submitSearch(event) {
    event.preventDefault();
    if (!validateForm()) return;
    const button = $("#startButton");
    button.disabled = true;
    button.firstElementChild.textContent = "Starting…";
    const mainQuery = `${$("#businessType").value.trim()} in ${$("#location").value.trim()}`;
    const extras = $("#extraQueries").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const generatedName = `${$("#businessType").value.trim()} — ${$("#location").value.trim()}`;
    const body = new URLSearchParams({
      name: $("#jobName").value.trim() || generatedName, keywords: [mainQuery, ...extras].join("\n"), lang: $("#language").value.trim().toLowerCase(),
      zoom: $("#zoom").value, latitude: $("#latitude").value || "0", longitude: $("#longitude").value || "0",
      radius: $("#radius").value || "10000", depth: $("#depth").value, maxtime: $("#maxTime").value, proxies: $("#proxies").value.trim()
    });
    if ($("#fetchEmails").checked) body.set("email", "on");
    if ($("#fastMode").checked) body.set("fastmode", "on");
    try {
      const response = await fetch("/scrape", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body });
      if (!response.ok) throw new Error((await response.text()).trim() || "Could not start the search");
      toast("Search started successfully");
      await loadJobs();
    } catch (error) {
      const message = $("#formMessage");
      message.textContent = error.message;
      message.classList.add("show");
    } finally {
      button.disabled = false;
      button.firstElementChild.textContent = "Start search";
    }
  }

  async function deleteJob(id) {
    const job = state.jobs.find((item) => item.ID === id);
    if (!job || !confirm(`Delete “${job.Name}” and its saved CSV?`)) return;
    try {
      const response = await fetch(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      state.jobs = state.jobs.filter((item) => item.ID !== id);
      jobsSignature = JSON.stringify(state.jobs);
      renderJobs();
      toast("Discovery run deleted");
    } catch (_error) {
      toast("Could not delete this run. Check the engine and try again.");
    }
  }

  function parseCSV(text) {
    const output = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i], next = text[i + 1];
      if (quoted) {
        if (char === '"' && next === '"') { field += '"'; i++; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n") { row.push(field.replace(/\r$/, "")); output.push(row); row = []; field = ""; }
      else field += char;
    }
    if (field || row.length) { row.push(field); output.push(row); }
    const headers = output.shift() || [];
    return output.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] || ""])));
  }

  function normalizedEmail(value) {
    const emails = String(value || "").match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/ig) || [];
    return [...new Set(emails)].join(", ");
  }

  function scoreLead(row) {
    let score = 10;
    if (String(row.phone || "").replace(/\D/g, "").length >= 10) score += 18;
    if (/^https?:\/\//i.test(row.website || "")) score += 18;
    if (row.emails) score += 22;
    if (row.address) score += 12;
    if (Number(row.review_rating) >= 4) score += 10;
    if (Number(row.review_count) >= 10) score += 10;
    return Math.min(100, score);
  }

  function prepareRows(rows) {
    const seen = new Map();
    rows.forEach((row) => {
      row.emails = normalizedEmail(row.emails);
      row.quality = scoreLead(row);
      const key = row.place_id || row.cid || row.phone?.replace(/\D/g, "") || `${row.title}|${row.address}`.toLowerCase();
      const existing = seen.get(key);
      if (!existing || row.quality > existing.quality) seen.set(key, row);
    });
    const unique = [...seen.values()];
    const titleCounts = new Map();
    const titleKey = (title) => String(title || "").toLowerCase().split(/\s[-–|]\s/)[0].replace(/\b(inc|llc|ltd|pllc|pc)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    unique.forEach((row) => titleCounts.set(titleKey(row.title), (titleCounts.get(titleKey(row.title)) || 0) + 1));
    unique.forEach((row) => {
      const chainHint = titleCounts.get(titleKey(row.title)) > 1 || /\b(group|corporation|centers?|health system|associates)\b/i.test(row.title || "");
      row.lead_type = chainHint ? "Likely chain / group" : "Independent signal";
      row.contact_gap = !row.website ? "Find website" : !row.phone ? "Find phone" : !row.emails ? "Find email" : "Contact ready";
    });
    return unique;
  }

  async function openResults(id) {
    const job = state.jobs.find((item) => item.ID === id);
    if (!job) return;
    const panel = $("#resultsPanel");
    panel.hidden = false;
    $("#resultsTitle").textContent = job.Name;
    $("#resultsSubtitle").textContent = "Loading and checking lead quality…";
    $("#resultsBody").innerHTML = '<tr><td><span class="loader"></span></td></tr>';
    try {
      const response = await fetch(`/api/v1/jobs/${encodeURIComponent(id)}/download`);
      if (!response.ok) throw new Error("The result file is not ready yet.");
      const rawRows = parseCSV(await response.text());
      state.selectedJob = job;
      state.rows = prepareRows(rawRows);
      state.page = 1;
      $("#resultsSubtitle").textContent = `${rawRows.length.toLocaleString()} collected · ${state.rows.length.toLocaleString()} unique after automatic deduplication`;
      renderColumnPicker();
      applyFilters();
    } catch (error) {
      $("#resultsSubtitle").textContent = error.message;
      $("#resultsBody").innerHTML = `<tr><td>${escapeHTML(error.message)}</td></tr>`;
    }
  }

  function renderMetrics() {
    const rows = state.rows;
    const count = (key) => rows.filter((row) => row[key]).length;
    const high = rows.filter((row) => row.quality >= 75).length;
    const average = rows.length ? (rows.reduce((sum, row) => sum + Number(row.review_rating || 0), 0) / rows.filter((row) => Number(row.review_rating) > 0).length || 0).toFixed(1) : "0.0";
    const values = [[rows.length, "Unique leads"], [count("phone"), "With phone"], [count("website"), "With website"], [count("emails"), "With email"], [high, `High quality · ${average} avg rating`]];
    $("#metrics").innerHTML = values.map(([value, label]) => `<div class="metric"><b>${Number(value).toLocaleString()}</b><span>${escapeHTML(label)}</span></div>`).join("");
  }

  function applyFilters() {
    const query = $("#resultSearch").value.trim().toLowerCase();
    const contact = $("#contactFilter").value;
    const minRating = Number($("#ratingFilter").value);
    const minReviews = Number($("#reviewFilter").value);
    state.filtered = state.rows.filter((row) => {
      const haystack = [row.title, row.category, row.address, row.phone, row.emails, row.website].join(" ").toLowerCase();
      const contactMatch = contact === "all" || (contact === "complete" ? row.phone && row.website && row.emails : Boolean(row[contact]));
      return (!query || haystack.includes(query)) && contactMatch && Number(row.review_rating || 0) >= minRating && Number(row.review_count || 0) >= minReviews;
    });
    state.filtered.sort((a, b) => {
      const av = a[state.sortKey] ?? "", bv = b[state.sortKey] ?? "";
      return (typeof av === "number" ? av - Number(bv) : String(av).localeCompare(String(bv), undefined, { numeric: true })) * state.sortDir;
    });
    const maxPage = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.page = Math.min(state.page, maxPage);
    renderMetrics();
    renderTable();
  }

  function cellHTML(row, key) {
    const value = row[key] ?? "";
    if (key === "quality") return `<span class="quality ${value >= 75 ? "high" : value >= 50 ? "medium" : "low"}">${value}</span>`;
    if (key === "website" && value) return `<a href="${escapeHTML(value)}" target="_blank" rel="noopener" title="${escapeHTML(value)}">Visit site</a>`;
    if (key === "emails" && value) return `<a href="mailto:${escapeHTML(value.split(",")[0])}" title="${escapeHTML(value)}">${escapeHTML(value)}</a>`;
    if (key === "phone" && value) return `<a href="tel:${escapeHTML(value)}">${escapeHTML(value)}</a>`;
    if (key === "review_rating" && value) return `${Number(value).toFixed(1)} ★`;
    return escapeHTML(value || "—");
  }

  function renderTable() {
    const start = (state.page - 1) * state.pageSize;
    const pageRows = state.filtered.slice(start, start + state.pageSize);
    $("#resultsHead").innerHTML = `<tr>${visibleColumns.map((key) => `<th data-sort="${key}">${escapeHTML(columnLabels[key] || key)}${state.sortKey === key ? (state.sortDir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr>`;
    $("#resultsBody").innerHTML = pageRows.length ? pageRows.map((row) => `<tr>${visibleColumns.map((key) => `<td title="${escapeHTML(row[key] || "")}">${cellHTML(row, key)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${visibleColumns.length}">No leads match these filters.</td></tr>`;
    const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    $("#resultCount").textContent = `${state.filtered.length.toLocaleString()} of ${state.rows.length.toLocaleString()} leads`;
    $("#pageLabel").textContent = `Page ${state.page} of ${pages}`;
    $("#prevPage").disabled = state.page <= 1;
    $("#nextPage").disabled = state.page >= pages;
  }

  function renderColumnPicker() {
    $("#columnPicker").innerHTML = Object.entries(columnLabels).map(([key, label]) => `<label><input type="checkbox" value="${key}" ${visibleColumns.includes(key) ? "checked" : ""}>${escapeHTML(label)}</label>`).join("");
  }

  function csvEscape(value) {
    const string = String(value ?? "");
    return /[",\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
  }

  function downloadBlob(content, type, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function exportName(extension) {
    const name = String(state.selectedJob?.Name || "prospect-atlas-leads").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").toLowerCase();
    return `${name || "prospect-atlas-leads"}-filtered.${extension}`;
  }

  function exportCSV() {
    const lines = [visibleColumns.map((key) => csvEscape(columnLabels[key] || key)).join(","), ...state.filtered.map((row) => visibleColumns.map((key) => csvEscape(row[key])).join(","))];
    downloadBlob("\ufeff" + lines.join("\r\n"), "text/csv;charset=utf-8", exportName("csv"));
    toast(`Exported ${state.filtered.length.toLocaleString()} filtered leads`);
  }

  function exportExcel() {
    const table = `<table><thead><tr>${visibleColumns.map((key) => `<th>${escapeHTML(columnLabels[key] || key)}</th>`).join("")}</tr></thead><tbody>${state.filtered.map((row) => `<tr>${visibleColumns.map((key) => `<td>${escapeHTML(row[key] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    downloadBlob(`\ufeff<html><head><meta charset="utf-8"></head><body>${table}</body></html>`, "application/vnd.ms-excel", exportName("xls"));
    toast(`Exported ${state.filtered.length.toLocaleString()} rows for Excel`);
  }

  function bindEvents() {
    $("#searchForm").addEventListener("submit", submitSearch);
    $("#presetList").addEventListener("click", (event) => { const button = event.target.closest("[data-preset]"); if (button) applyPreset(button.dataset.preset); });
    ["#depth", "#maxTime", "#fetchEmails"].forEach((selector) => $(selector).addEventListener("change", updateSettingsSummary));
    $("#refreshJobs").addEventListener("click", () => loadJobs(true));
    $("#jobList").addEventListener("click", (event) => {
      const open = event.target.closest("[data-open]"), remove = event.target.closest("[data-delete]");
      if (open) openResults(open.dataset.open);
      if (remove) deleteJob(remove.dataset.delete);
    });
    $("#closeResults").addEventListener("click", () => $("#resultsPanel").hidden = true);
    ["#resultSearch", "#contactFilter", "#ratingFilter", "#reviewFilter"].forEach((selector) => $(selector).addEventListener(selector === "#resultSearch" ? "input" : "change", () => { state.page = 1; applyFilters(); }));
    $("#resultsHead").addEventListener("click", (event) => { const th = event.target.closest("[data-sort]"); if (!th) return; state.sortDir = state.sortKey === th.dataset.sort ? -state.sortDir : 1; state.sortKey = th.dataset.sort; applyFilters(); });
    $("#columnButton").addEventListener("click", () => $("#columnPicker").hidden = !$("#columnPicker").hidden);
    $("#columnPicker").addEventListener("change", () => { visibleColumns = $$("#columnPicker input:checked").map((input) => input.value); if (!visibleColumns.length) { visibleColumns = ["title"]; renderColumnPicker(); } renderTable(); });
    $("#prevPage").addEventListener("click", () => { state.page--; renderTable(); });
    $("#nextPage").addEventListener("click", () => { state.page++; renderTable(); });
    $("#exportCsv").addEventListener("click", exportCSV);
    $("#exportExcel").addEventListener("click", exportExcel);
  }

  bindEvents();
  loadJobs();
  setInterval(loadJobs, 6000);
})();
