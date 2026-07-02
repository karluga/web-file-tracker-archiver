const sitesEl = document.querySelector("#sites");
const statusEl = document.querySelector("#status");
const dialog = document.querySelector("#siteDialog");
const form = document.querySelector("#siteForm");
const rulesEl = document.querySelector("#rules");

let config = DEFAULT_CONFIG;

function setStatus(message) {
  statusEl.textContent = message;
  if (message) {
    window.setTimeout(() => {
      if (statusEl.textContent === message) statusEl.textContent = "";
    }, 4000);
  }
}

function idFromName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function load() {
  config = await getConfig();
  render();
}

function render() {
  const sites = config.sites || [];
  sitesEl.innerHTML = sites.length
    ? sites.map(renderSite).join("")
    : '<p class="empty">No tracked sites yet.</p>';
}

function renderSite(site) {
  const rules = (site.rules || []).map((rule) => `${rule.type}: ${rule.value}`).join(", ");
  return `
    <article class="site">
      <div class="site-header">
        <div>
          <p class="site-title">${escapeHtml(site.name)}</p>
          <p class="site-url">${escapeHtml(site.pageUrl)}</p>
          <p class="site-meta">${site.enabled ? "Enabled" : "Paused"} - ${site.intervalDays === 0 ? "Every visit" : `Every ${site.intervalDays} day(s)`} - ${site.archiveMode === "full-copy" ? "Full copy" : "Main-file append"} - main: ${escapeHtml(site.mainFilePattern || "^main\\..*\\.js$")} - ${escapeHtml(rules || "No rules")}</p>
        </div>
        <div class="site-actions">
          <button type="button" class="secondary" data-edit="${site.id}">Edit</button>
          <button type="button" class="secondary danger" data-delete="${site.id}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function addRuleRow(rule = { type: "folder", value: "/" }) {
  const row = document.createElement("div");
  row.className = "rule-row";
  row.innerHTML = `
    <label>
      <span>Type</span>
      <select class="rule-type">
        <option value="folder">Folder</option>
        <option value="file">File</option>
        <option value="regex">Regex</option>
      </select>
    </label>
    <label>
      <span>Value</span>
      <input class="rule-value" required>
    </label>
    <button type="button" class="secondary danger">Remove</button>
  `;
  row.querySelector(".rule-type").value = rule.type;
  row.querySelector(".rule-value").value = rule.value;
  row.querySelector("button").addEventListener("click", () => row.remove());
  rulesEl.append(row);
}

function openDialog(site = null) {
  form.reset();
  rulesEl.innerHTML = "";
  document.querySelector("#dialogTitle").textContent = site ? "Edit Site" : "Add Site";
  document.querySelector("#siteId").value = site?.id || "";
  document.querySelector("#siteName").value = site?.name || "";
  document.querySelector("#pageUrl").value = site?.pageUrl || "";
  document.querySelector("#enabled").checked = site?.enabled ?? true;
  document.querySelector("#intervalDays").value = String(site?.intervalDays ?? 1);
  document.querySelector("#mainFilePattern").value = site?.mainFilePattern || "^main\\..*\\.js$";
  document.querySelector("#archiveMode").value = site?.archiveMode || "main-file";
  (site?.rules?.length ? site.rules : [{ type: "folder", value: "/" }]).forEach(addRuleRow);
  dialog.showModal();
}

function collectFormSite() {
  const name = document.querySelector("#siteName").value.trim();
  const id = document.querySelector("#siteId").value || idFromName(name);
  return {
    id,
    name,
    pageUrl: normalizeUrl(document.querySelector("#pageUrl").value.trim()),
    enabled: document.querySelector("#enabled").checked,
    intervalDays: Number(document.querySelector("#intervalDays").value),
    archiveMode: document.querySelector("#archiveMode").value,
    mainFilePattern: document.querySelector("#mainFilePattern").value.trim() || "^main\\..*\\.js$",
    rules: Array.from(rulesEl.querySelectorAll(".rule-row")).map((row) => ({
      type: row.querySelector(".rule-type").value,
      value: row.querySelector(".rule-value").value.trim()
    })).filter((rule) => rule.value)
  };
}

async function persist(message = "Saved") {
  await saveConfig(config);
  render();
  setStatus(message);
}

sitesEl.addEventListener("click", async (event) => {
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;

  if (editId) {
    openDialog(config.sites.find((site) => site.id === editId));
  }

  if (deleteId) {
    config.sites = config.sites.filter((site) => site.id !== deleteId);
    await persist("Deleted");
  }
});

document.querySelector("#addSite").addEventListener("click", () => openDialog());
document.querySelector("#addRule").addEventListener("click", () => addRuleRow());
document.querySelector("#cancelDialog").addEventListener("click", () => dialog.close());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const site = collectFormSite();
  const index = config.sites.findIndex((item) => item.id === site.id);
  if (index >= 0) config.sites[index] = site;
  else config.sites.push(site);
  dialog.close();
  await persist("Saved");
});

document.querySelector("#syncConfig").addEventListener("click", async () => {
  try {
    await syncConfig(config);
    setStatus("Synced to local app");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#learnCurrent").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_RESOURCES" });
    const url = new URL(response.pageUrl);
    const candidates = response.resources
      .filter((resourceUrl) => resourceUrl.startsWith(url.origin))
      .map((resourceUrl) => new URL(resourceUrl).pathname.split("/").pop())
      .filter((name) => /\.(js|css)$/.test(name));
    const prefixes = Array.from(new Set(candidates.map((name) => name.split(".")[0]).filter(Boolean))).slice(0, 3);
    openDialog({
      id: idFromName(url.hostname),
      name: url.hostname,
      pageUrl: response.pageUrl,
      enabled: true,
      intervalDays: 1,
      archiveMode: "main-file",
      mainFilePattern: "^main\\..*\\.js$",
      rules: prefixes.length
        ? prefixes.map((prefix) => ({ type: "regex", value: `^${prefix}\\..*\\.(js|css)$` }))
        : [{ type: "folder", value: "/" }]
    });
    setStatus(`Found ${candidates.length} script/style resource(s)`);
  } catch (error) {
    setStatus(error.message);
  }
});

load();
