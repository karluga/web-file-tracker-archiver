const sitesEl = document.querySelector("#sites");
const eventsEl = document.querySelector("#events");
const siteCountEl = document.querySelector("#siteCount");
const archiveCountEl = document.querySelector("#archiveCount");
const refreshButton = document.querySelector("#refreshButton");
const dashboardView = document.querySelector("#dashboardView");
const docsView = document.querySelector("#docsView");
const docsEl = document.querySelector("#docs");
const tabButtons = Array.from(document.querySelectorAll(".tab"));

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function formatDate(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function renderSite(site, state) {
  const check = state.checks?.[site.id] || {};
  const files = Object.keys(state.files?.[site.id] || {});
  const archive = state.archives?.[site.id]?.current || null;
  const rules = (site.rules || []).map((rule) => `${rule.type}: ${rule.value}`).join(", ");

  return `
    <article class="site">
      <div class="site-header">
        <div>
          <p class="site-title">${escapeHtml(site.name)}</p>
          <p class="site-url">${escapeHtml(site.pageUrl)}</p>
        </div>
        <span class="pill">${site.enabled ? "Enabled" : "Paused"}</span>
      </div>
      <div class="site-grid">
        <div class="metric">
          <div class="metric-label">Last checked</div>
          <div class="metric-value">${escapeHtml(formatDate(check.lastCheckedAt))}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Interval</div>
          <div class="metric-value">${site.intervalDays === 0 ? "Every visit" : `${site.intervalDays} day(s)`}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Strategy</div>
          <div class="metric-value">${site.archiveMode === "full-copy" ? "Full copy" : "Main-file append"}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Known files</div>
          <div class="metric-value">${files.length}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Archive folder</div>
          <div class="metric-value">${escapeHtml(archive?.folder || "No baseline")}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Main file</div>
          <div class="metric-value">${escapeHtml(archive?.mainFileName || site.mainFilePattern || "^main\\..*\\.js$")}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Rules</div>
          <div class="metric-value">${escapeHtml(rules || "No rules")}</div>
        </div>
      </div>
    </article>
  `;
}

function renderEvent(event) {
  const changes = event.changes || [];
  const failures = event.failures || [];
  const changeItems = changes.map((change) => `<li>${escapeHtml(change.path || change.url)}</li>`).join("");
  const failureItems = failures.map((failure) => `<li class="warning">${escapeHtml(failure.url)}: ${escapeHtml(failure.error)}</li>`).join("");

  return `
    <article class="event">
      <div class="event-header">
        <div>
          <p class="event-title">${escapeHtml(event.siteName || event.siteId)} ${event.type === "baseline" ? "created baseline" : event.type === "rollover" ? "rolled archive" : event.type === "archive" ? "archived changes" : "checked files"}</p>
          <p class="event-meta">${escapeHtml(formatDate(event.at))} - ${event.resourceCount || 0} resource(s)${event.archiveFolder ? ` - ${escapeHtml(event.archiveFolder)}` : ""}</p>
        </div>
        <span class="pill">${changes.length} changed</span>
      </div>
      ${changes.length || failures.length ? `<ul>${changeItems}${failureItems}</ul>` : ""}
    </article>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let inCode = false;
  let inList = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }

    if (line.startsWith("# ")) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<h2>${escapeHtml(line.slice(2))}</h2>`);
      continue;
    }

    if (line.startsWith("## ")) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<h3>${escapeHtml(line.slice(3))}</h3>`);
      continue;
    }

    if (/^\d+\. /.test(line)) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<p class="step">${escapeHtml(line)}</p>`);
      continue;
    }

    if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }

    if (inList) {
      html.push("</ul>");
      inList = false;
    }
    html.push(`<p>${escapeHtml(line)}</p>`);
  }

  if (inList) html.push("</ul>");
  if (inCode) html.push("</code></pre>");
  return html.join("");
}

async function renderDocs() {
  try {
    const data = await getJson("/api/readme");
    docsEl.innerHTML = renderMarkdown(data.markdown || "");
  } catch (error) {
    docsEl.innerHTML = `<p class="empty warning">${escapeHtml(error.message)}</p>`;
  }
}

function switchTab(tabName) {
  dashboardView.classList.toggle("hidden", tabName !== "dashboard");
  docsView.classList.toggle("hidden", tabName !== "docs");
  refreshButton.classList.toggle("hidden", tabName !== "dashboard");
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  if (tabName === "docs" && !docsEl.innerHTML) {
    renderDocs();
  }
}

async function render() {
  try {
    const [config, state] = await Promise.all([
      getJson("/api/config"),
      getJson("/api/state")
    ]);

    const sites = config.sites || [];
    const events = state.events || [];
    const archivedFiles = events.reduce((sum, event) => sum + (event.changes?.length || 0), 0);

    siteCountEl.textContent = `${sites.length} site${sites.length === 1 ? "" : "s"}`;
    archiveCountEl.textContent = `${archivedFiles} archived file${archivedFiles === 1 ? "" : "s"}`;
    sitesEl.innerHTML = sites.length ? sites.map((site) => renderSite(site, state)).join("") : '<p class="empty">No sites yet. Add them from the extension options page.</p>';
    eventsEl.innerHTML = events.length ? events.map(renderEvent).join("") : '<p class="empty">No checks have been recorded yet.</p>';
  } catch (error) {
    sitesEl.innerHTML = `<p class="empty warning">${escapeHtml(error.message)}</p>`;
  }
}

refreshButton.addEventListener("click", render);
tabButtons.forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});
render();
