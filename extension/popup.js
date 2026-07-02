const sitesEl = document.querySelector("#sites");
const statusEl = document.querySelector("#status");
const connectionEl = document.querySelector("#connection");
const firstArchiveButton = document.querySelector("#firstArchive");
const scanNowButton = document.querySelector("#scanNow");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function render() {
  const config = await getConfig();
  const sites = config.sites || [];
  sitesEl.innerHTML = sites.length
    ? sites.map((site) => `
      <article class="site">
        <div>
          <p class="site-name">${escapeHtml(site.name)}</p>
          <p class="site-url">${escapeHtml(new URL(site.pageUrl).hostname)}</p>
        </div>
        <span>${site.enabled ? "On" : "Paused"}</span>
      </article>
    `).join("")
    : "<p>No tracked sites.</p>";

  try {
    const response = await fetch(`${LOCAL_APP_URL}/api/state`);
    connectionEl.textContent = response.ok ? "Connected" : "Offline";
  } catch {
    connectionEl.textContent = "Offline";
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeStatus = await chrome.runtime.sendMessage({ type: "ACTIVE_SITE_STATUS", tabId: tab?.id });
    if (activeStatus?.error) throw new Error(activeStatus.error);
    firstArchiveButton.hidden = Boolean(activeStatus.hasArchive);
    scanNowButton.disabled = !activeStatus.hasArchive;
    statusEl.textContent = activeStatus.hasArchive
      ? `Current archive: ${activeStatus.current?.folder || "ready"}`
      : "Create the first archive before daily scans.";
  } catch (error) {
    firstArchiveButton.hidden = true;
    scanNowButton.disabled = false;
    statusEl.textContent = "";
  }
}

firstArchiveButton.addEventListener("click", async () => {
  statusEl.textContent = "Creating first archive...";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = await chrome.runtime.sendMessage({ type: "FIRST_ARCHIVE", tabId: tab?.id });
  statusEl.textContent = result.error || result.reason || result.status || "Done";
  render();
});

scanNowButton.addEventListener("click", async () => {
  statusEl.textContent = "Scanning active tab...";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = await chrome.runtime.sendMessage({ type: "SCAN_NOW", tabId: tab?.id });
  statusEl.textContent = result.error || result.reason || result.status || "Done";
});

document.querySelector("#options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#dashboard").addEventListener("click", () => chrome.tabs.create({ url: LOCAL_APP_URL }));

render();
