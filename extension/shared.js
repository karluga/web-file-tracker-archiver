const LOCAL_APP_URL = "http://localhost:4177";

const DEFAULT_CONFIG = {
  sites: [
    {
      id: "project-restoration",
      name: "Project Restoration",
      pageUrl: "https://cdn.project-restoration.com/kongregate.html",
      enabled: true,
      intervalDays: 1,
      archiveMode: "main-file",
      mainFilePattern: "^main\\..*\\.js$",
      rules: [
        { type: "folder", value: "/" },
        { type: "regex", value: "^.*\\.(js|css)$" }
      ]
    }
  ]
};

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value || "";
  }
}

function pageKey(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value || "";
  }
}

function samePage(a, b) {
  return pageKey(a) === pageKey(b);
}

function ruleMatches(rule, resourceUrl) {
  let url;
  try {
    url = new URL(resourceUrl);
  } catch {
    return false;
  }

  if (rule.type === "folder") {
    return url.pathname.startsWith(rule.value || "/");
  }

  if (rule.type === "file") {
    return url.pathname === rule.value;
  }

  if (rule.type === "regex") {
    try {
      return new RegExp(rule.value).test(url.pathname.split("/").pop() || url.pathname);
    } catch {
      return false;
    }
  }

  return false;
}

function filterResources(site, resources) {
  const pageOrigin = new URL(site.pageUrl).origin;
  return resources.filter((resourceUrl) => {
    try {
      const resource = new URL(resourceUrl);
      return resource.origin === pageOrigin && (site.rules || []).some((rule) => ruleMatches(rule, resourceUrl));
    } catch {
      return false;
    }
  });
}

async function getConfig() {
  const result = await chrome.storage.local.get({ config: DEFAULT_CONFIG });
  return result.config;
}

async function saveConfig(config) {
  await chrome.storage.local.set({ config });
}

async function syncConfig(config) {
  const response = await fetch(`${LOCAL_APP_URL}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!response.ok) throw new Error(`Local app returned HTTP ${response.status}`);
  return response.json();
}
