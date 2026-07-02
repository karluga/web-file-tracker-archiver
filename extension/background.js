importScripts("shared.js");

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  await saveConfig(config);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PAGE_VISITED") {
    handlePageVisit(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === "SYNC_CONFIG") {
    getConfig().then(syncConfig).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === "SCAN_NOW") {
    scanCurrentTab(message.tabId, false).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === "FIRST_ARCHIVE") {
    scanCurrentTab(message.tabId, true).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === "ACTIVE_SITE_STATUS") {
    getActiveSiteStatus(message.tabId).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});

async function handlePageVisit(message) {
  const config = await getConfig();
  const site = (config.sites || []).find((item) => item.enabled && samePage(item.pageUrl, message.pageUrl));

  if (!site) {
    return { status: "ignored" };
  }

  const resources = filterResources(site, message.resources || []);
  if (!resources.length) {
    return { status: "ignored", reason: "No resources matched this site's rules." };
  }

  return postCheck(site.id, resources, false);
}

async function getCurrentTrackedSite(tabId) {
  const tab = tabId
    ? await chrome.tabs.get(tabId)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_RESOURCES" });
  const config = await getConfig();
  const site = (config.sites || []).find((item) => item.enabled && samePage(item.pageUrl, response.pageUrl));

  if (!site) {
    throw new Error("The active page is not a configured tracked site.");
  }

  return { tab, response, site };
}

async function scanCurrentTab(tabId, baseline) {
  const { response, site } = await getCurrentTrackedSite(tabId);
  const resources = filterResources(site, response.resources || []);
  return postCheck(site.id, resources, true, baseline);
}

async function getActiveSiteStatus(tabId) {
  const { site } = await getCurrentTrackedSite(tabId);
  const response = await fetch(`${LOCAL_APP_URL}/api/archive-status?siteId=${encodeURIComponent(site.id)}`);
  if (!response.ok) {
    throw new Error(`Local app returned HTTP ${response.status}`);
  }
  return {
    siteId: site.id,
    siteName: site.name,
    ...(await response.json())
  };
}

async function postCheck(siteId, resources, force, baseline = false) {
  const response = await fetch(`${LOCAL_APP_URL}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteId, resources, force, baseline })
  });

  if (!response.ok) {
    throw new Error(`Local app returned HTTP ${response.status}`);
  }

  return response.json();
}
