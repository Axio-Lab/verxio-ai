const state = {
  data: null,
  loading: true,
  running: false,
  activeRunId: "",
  pollTimer: null,
  error: "",
};

const el = {
  runtime: document.querySelector("#runtime-status"),
  loading: document.querySelector("#loading-state"),
  content: document.querySelector("#content"),
  error: document.querySelector("#error-banner"),
  agentName: document.querySelector("#agent-name"),
  agentDescription: document.querySelector("#agent-description"),
  agentStatus: document.querySelector("#agent-status"),
  modelLabel: document.querySelector("#model-label"),
  form: document.querySelector("#run-form"),
  taskInput: document.querySelector("#task-input"),
  runButton: document.querySelector("#run-button"),
  stopButton: document.querySelector("#stop-button"),
  starterRow: document.querySelector("#starter-row"),
  result: document.querySelector("#run-result"),
  runtimeList: document.querySelector("#runtime-list"),
  runtimeErrors: document.querySelector("#runtime-errors"),
  connectionCount: document.querySelector("#connection-count"),
  connectionList: document.querySelector("#connection-list"),
  runCount: document.querySelector("#run-count"),
  runList: document.querySelector("#run-list"),
  refreshButton: document.querySelector("#refresh-button"),
};

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return response.json();
}

async function load() {
  state.loading = true;
  state.error = "";
  render();
  try {
    state.data = await fetchJson("/api/bootstrap");
  } catch (error) {
    state.error = error.message || "Could not load Verxio.";
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  el.loading.classList.toggle("hidden", !state.loading);
  el.content.classList.toggle("hidden", state.loading || !state.data);
  el.error.classList.toggle("hidden", !state.error);
  el.error.textContent = state.error;

  if (!state.data) return;
  renderRuntime();
  renderProfile();
  renderConnections();
  renderRuns();
}

function renderRuntime() {
  const runtime = state.data.runtime;
  const hermes = state.data.hermes || {};
  const model = currentModel(hermes);

  el.runtime.className = "runtime-pill";
  if (runtime.connected) el.runtime.classList.add("connected");
  if (!runtime.connected) el.runtime.classList.add("demo");
  el.runtime.textContent = runtime.connected ? "Hermes connected" : `${runtime.mode} runtime`;
  el.runtime.title = runtime.detail;
  el.modelLabel.textContent = model || "Hermes model";

  const features = hermes.capabilities?.features || {};
  const gatewayPlatforms = platformRows(hermes);
  const entries = [
    ["Base URL", runtime.base_url],
    ["Mode", runtime.mode],
    ["Gateway state", hermes.health?.gateway_state || (runtime.connected ? "running" : "offline")],
    ["API model alias", model || "hermes-agent"],
    ["Model source", "Hermes config via hermes model"],
    ["Runs API", boolLabel(features.run_submission)],
    ["Run events", boolLabel(features.run_events_sse)],
    ["Sessions", boolLabel(features.session_resources)],
    ["Skills API", boolLabel(features.skills_api)],
    ["Config API", boolLabel(features.admin_config_rw)],
    ["Jobs admin", boolLabel(features.jobs_admin)],
    ["Gateway platforms", String(gatewayPlatforms.length)],
    ["Cron jobs", String((hermes.jobs || []).length)],
    ["Toolsets", String((hermes.toolsets || []).length)],
  ];
  el.runtimeList.innerHTML = entries
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");

  const errors = hermes.errors || [];
  el.runtimeErrors.innerHTML = errors.length
    ? errors.map((error) => `<p>${escapeHtml(error)}</p>`).join("")
    : "";
}

function renderProfile() {
  const profile = state.data.profile;
  el.agentName.textContent = profile.name;
  el.agentDescription.textContent = profile.description;
  el.agentStatus.textContent = profile.status;

  if (!el.taskInput.value.trim()) {
    el.taskInput.placeholder = profile.starters[0] || "Ask Hermes through Verxio...";
  }

  el.starterRow.innerHTML = "";
  for (const starter of profile.starters) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "starter-button";
    button.textContent = starter;
    button.addEventListener("click", () => {
      el.taskInput.value = starter;
      el.taskInput.focus();
    });
    el.starterRow.appendChild(button);
  }
}

function renderConnections() {
  const hermes = state.data.hermes || {};
  const rows = [
    ...platformRows(hermes),
    ...summaryRows("Model", hermes.models || [], "id"),
    ...summaryRows("Job", hermes.jobs || [], "name"),
    ...summaryRows("Skill", hermes.skills || [], "name"),
    ...summaryRows("Toolset", hermes.toolsets || [], "name"),
  ];

  el.connectionCount.textContent = String(rows.length);
  if (!rows.length) {
    el.connectionList.innerHTML = `<div class="empty-state queue-item"><strong>No metadata yet</strong><p>Hermes is connected, but this API surface did not return gateway platforms, models, jobs, skills, or toolsets.</p></div>`;
    return;
  }

  el.connectionList.innerHTML = rows
    .slice(0, 10)
    .map(
      (row) => `<article class="queue-item"><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.detail)}</p></article>`,
    )
    .join("");
}

function renderRuns() {
  const runs = state.data.runs || [];
  el.runCount.textContent = String(runs.length);
  if (!runs.length) {
    el.runList.innerHTML = `<div class="empty-state audit-item"><strong>No runs yet</strong><p>Messages you send through Hermes will appear here.</p></div>`;
    return;
  }

  el.runList.innerHTML = runs
    .slice(0, 8)
    .map((run) => {
      const time = new Date(run.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      const output = run.output ? `<p class="small">${escapeHtml(run.output)}</p>` : "";
      return `<article class="audit-item"><strong>${escapeHtml(run.status)}</strong><p>${escapeHtml(run.input)}</p>${output}<p class="small">${escapeHtml(time)}${run.hermes_run_id ? ` - ${escapeHtml(run.hermes_run_id)}` : ""}</p></article>`;
    })
    .join("");
}

async function runAgent(event) {
  event.preventDefault();
  const input = el.taskInput.value.trim();
  if (!input) return;

  state.running = true;
  state.activeRunId = "";
  state.error = "";
  el.runButton.disabled = true;
  el.stopButton.classList.add("hidden");
  el.runButton.textContent = "Starting...";
  el.form.setAttribute("aria-busy", "true");
  el.result.className = "result-box";
  el.result.textContent = "Starting Hermes run...";

  try {
    const run = await fetchJson("/api/runs", {
      method: "POST",
      body: JSON.stringify({ agent_id: state.data.profile.id, input }),
    });
    renderRunResult(run);
    state.activeRunId = run.id;
    state.data = await fetchJson("/api/bootstrap");
    if (isActiveStatus(run.status)) {
      startPolling(run.id);
    } else {
      finishRun();
    }
  } catch (error) {
    state.error = error.message || "The Hermes run failed.";
    el.result.className = "result-box empty-state";
    el.result.innerHTML = `<p class="strong">Run failed</p><p>Review the error above and try again.</p>`;
    finishRun();
  } finally {
    render();
  }
}

function startPolling(runId) {
  stopPolling();
  state.running = true;
  el.runButton.disabled = true;
  el.runButton.textContent = "Hermes running";
  el.stopButton.classList.remove("hidden");
  el.form.setAttribute("aria-busy", "true");

  state.pollTimer = window.setInterval(async () => {
    try {
      const run = await fetchJson(`/api/runs/${runId}`);
      renderRunResult(run);
      if (!isActiveStatus(run.status)) {
        state.data = await fetchJson("/api/bootstrap");
        finishRun();
        render();
      }
    } catch (error) {
      state.error = error.message || "Could not refresh the Hermes run.";
      finishRun();
      render();
    }
  }, 1600);
}

function stopPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function finishRun() {
  stopPolling();
  state.running = false;
  state.activeRunId = "";
  el.runButton.disabled = false;
  el.runButton.textContent = "Send to Hermes";
  el.stopButton.classList.add("hidden");
  el.form.removeAttribute("aria-busy");
}

async function stopActiveRun() {
  if (!state.activeRunId) return;
  el.stopButton.disabled = true;
  el.stopButton.textContent = "Stopping...";
  try {
    const run = await fetchJson(`/api/runs/${state.activeRunId}/stop`, { method: "POST" });
    renderRunResult(run);
  } catch (error) {
    state.error = error.message || "Could not stop the Hermes run.";
  } finally {
    el.stopButton.disabled = false;
    el.stopButton.textContent = "Stop run";
    finishRun();
    render();
  }
}

function renderRunResult(run) {
  const statusLabel = run.status.replaceAll("_", " ");
  const hermesLine = run.hermes_run_id ? `Hermes run: ${run.hermes_run_id}` : `Runtime: ${run.provider}`;
  const output = run.output || (isActiveStatus(run.status) ? "Hermes is working..." : "No visible output yet.");
  el.result.className = `result-box run-status status-${run.status}`;
  el.result.innerHTML = `
    <div class="run-meta">
      <span>${escapeHtml(statusLabel)}</span>
      <span>${escapeHtml(hermesLine)}</span>
    </div>
    <div class="run-output">${escapeHtml(output)}</div>
  `;
}

function isActiveStatus(status) {
  return status === "queued" || status === "running" || status === "waiting_for_approval";
}

function currentModel(hermes) {
  const model = hermes.models?.[0];
  return model?.id || model?.name || hermes.capabilities?.model || "";
}

function platformRows(hermes) {
  const platforms = hermes.health?.platforms || {};
  return Object.entries(platforms).map(([name, platform]) => {
    const state = platform?.state || "unknown";
    const error = platform?.error_message ? ` - ${platform.error_message}` : "";
    return {
      title: `Gateway: ${name}`,
      detail: `${state}${error}`,
    };
  });
}

function summaryRows(kind, items, key) {
  return items.map((item) => ({
    title: `${kind}: ${item[key] || item.id || item.slug || "unnamed"}`,
    detail: summaryDetail(kind, item),
  }));
}

function summaryDetail(kind, item) {
  if (kind === "Model") {
    return "Hermes API alias; real provider/model is configured in Hermes.";
  }
  return item.description || item.status || item.path || JSON.stringify(item).slice(0, 160);
}

function boolLabel(value) {
  if (value === true) return "Available";
  if (value === false) return "Unavailable";
  return "Unknown";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

el.form.addEventListener("submit", runAgent);
el.stopButton.addEventListener("click", stopActiveRun);
el.refreshButton.addEventListener("click", load);

load();
