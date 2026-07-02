const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4177);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const ARCHIVE_DIR = path.join(ROOT, "archives");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const README_PATH = path.join(ROOT, "README.md");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

const defaultConfig = {
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

const defaultState = {
  checks: {},
  files: {},
  archives: {},
  events: []
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await ensureJson(CONFIG_PATH, defaultConfig);
  await ensureJson(STATE_PATH, defaultState);
}

async function ensureJson(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2));
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function parseBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 5_000_000) {
      throw new Error("Request body too large");
    }
  }
  return body ? JSON.parse(body) : {};
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value || "site")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "site";
}

function safeArchivePath(site, timestamp, resourceUrl) {
  return path.join(ARCHIVE_DIR, slugify(site.name || site.id), timestamp, safeRelativeResourcePath(resourceUrl));
}

function safeRelativeResourcePath(resourceUrl) {
  const url = new URL(resourceUrl);
  const pathname = url.pathname.replace(/^\/+/, "") || "index";
  const cleanParts = pathname
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "_"));
  return path.join(...cleanParts);
}

async function fetchResource(resourceUrl) {
  const response = await fetch(resourceUrl, {
    cache: "no-store",
    headers: {
      "User-Agent": "WebFileTrackerArchiver/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function shouldCheck(checkState, intervalDays) {
  if (Number(intervalDays) === 0) return true;
  if (!checkState?.lastCheck) return true;
  const last = new Date(`${checkState.lastCheck}T00:00:00.000Z`);
  const now = new Date(`${todayKey()}T00:00:00.000Z`);
  const elapsedDays = Math.floor((now - last) / 86_400_000);
  return elapsedDays >= Math.max(1, Number(intervalDays || 1));
}

function addEvent(state, event) {
  state.events.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    ...event
  });
  state.events = state.events.slice(0, 200);
}

function getFileName(resourceUrl) {
  return new URL(resourceUrl).pathname.split("/").pop() || "";
}

function getMainFilePattern(site) {
  return site.mainFilePattern || "^main\\..*\\.js$";
}

function findMainResource(site, resources) {
  const pattern = new RegExp(getMainFilePattern(site));
  return resources.find((resourceUrl) => pattern.test(getFileName(resourceUrl))) || null;
}

async function writeArchivedFile(site, folder, resourceUrl, buffer) {
  const destination = path.join(ARCHIVE_DIR, slugify(site.name || site.id), folder, safeRelativeResourcePath(resourceUrl));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, buffer);
  return destination;
}

async function removeArchivedFile(site, folder, resourceUrl) {
  try {
    await fs.rm(path.join(ARCHIVE_DIR, slugify(site.name || site.id), folder, safeRelativeResourcePath(resourceUrl)), { force: true });
  } catch {
    // Missing old files are fine when migrating from older state.
  }
}

async function copyArchiveFolder(site, fromFolder, toFolder) {
  const siteRoot = path.join(ARCHIVE_DIR, slugify(site.name || site.id));
  await fs.cp(path.join(siteRoot, fromFolder), path.join(siteRoot, toFolder), { recursive: true });
}

async function fetchTrackedResources(resources) {
  const fetched = {};
  const failures = [];

  for (const resourceUrl of resources) {
    try {
      const buffer = await fetchResource(resourceUrl);
      fetched[resourceUrl] = {
        buffer,
        hash: hashBuffer(buffer)
      };
    } catch (error) {
      failures.push({ url: resourceUrl, error: error.message });
    }
  }

  return { fetched, failures };
}

function recordFileState(state, siteId, resourceUrl, fileInfo, archivedPath) {
  state.files[siteId][resourceUrl] = {
    hash: fileInfo.hash,
    lastSeen: new Date().toISOString(),
    path: archivedPath
  };
}

function hasAnyResourceChange(currentArchive, fetched) {
  return Object.entries(fetched).some(([resourceUrl, fileInfo]) => currentArchive?.files?.[resourceUrl]?.hash !== fileInfo.hash);
}

async function handleFullCopyArchive({ site, state, resources, fetched, failures, timestamp, currentArchive, payload }) {
  const changes = [];
  const changed = payload.baseline || !currentArchive || hasAnyResourceChange(currentArchive, fetched);
  const archiveFolder = changed ? timestamp : currentArchive.folder;
  const nextArchiveFiles = {};

  if (changed) {
    for (const [resourceUrl, fileInfo] of Object.entries(fetched)) {
      const previous = currentArchive?.files?.[resourceUrl] || state.files[site.id][resourceUrl] || null;
      const destination = await writeArchivedFile(site, archiveFolder, resourceUrl, fileInfo.buffer);
      const relativePath = path.relative(ROOT, destination);
      changes.push({
        url: resourceUrl,
        hash: fileInfo.hash,
        previousHash: previous?.hash || null,
        path: relativePath,
        action: payload.baseline ? "baseline" : previous?.hash === fileInfo.hash ? "copied" : previous ? "updated" : "added"
      });

      nextArchiveFiles[resourceUrl] = {
        hash: fileInfo.hash,
        path: relativePath
      };
      recordFileState(state, site.id, resourceUrl, fileInfo, relativePath);
    }
  } else {
    for (const [resourceUrl, fileInfo] of Object.entries(fetched)) {
      const archivedPath = currentArchive?.files?.[resourceUrl]?.path || null;
      nextArchiveFiles[resourceUrl] = currentArchive.files[resourceUrl];
      recordFileState(state, site.id, resourceUrl, fileInfo, archivedPath);
    }
  }

  state.archives[site.id].current = {
    folder: archiveFolder,
    mainUrl: null,
    mainFileName: null,
    files: changed ? nextArchiveFiles : currentArchive.files,
    createdAt: changed ? new Date().toISOString() : currentArchive.createdAt,
    updatedAt: new Date().toISOString(),
    mode: "full-copy"
  };

  return {
    archiveType: payload.baseline ? "baseline" : changed ? "full-copy" : "check",
    archiveFolder,
    changes,
    failures,
    status: payload.baseline ? "baseline_archived" : changed ? "full_copy_archived" : "unchanged",
    checked: resources.length
  };
}

async function handleMainFileArchive({ site, state, resources, fetched, failures, timestamp, currentArchive, payload, mainResource, mainFileName }) {
  const changes = [];
  let archiveFolder = currentArchive?.folder || timestamp;
  let archiveType = "append";
  let previousMainUrl = currentArchive?.mainUrl || null;
  const mainChanged = Boolean(currentArchive && mainResource && currentArchive.mainFileName && currentArchive.mainFileName !== mainFileName);

  if (payload.baseline || !currentArchive) {
    archiveType = "baseline";
  } else if (mainChanged) {
    archiveType = "rollover";
    archiveFolder = timestamp;
    await copyArchiveFolder(site, currentArchive.folder, archiveFolder);
    if (previousMainUrl) {
      await removeArchivedFile(site, archiveFolder, previousMainUrl);
    }
  }

  const nextArchiveFiles = archiveType === "rollover"
    ? { ...(currentArchive.files || {}) }
    : { ...(currentArchive?.files || {}) };

  for (const [resourceUrl, fileInfo] of Object.entries(fetched)) {
    const previous = state.files[site.id][resourceUrl] || nextArchiveFiles[resourceUrl] || null;
    const isNew = !nextArchiveFiles[resourceUrl];
    const changed = previous?.hash !== fileInfo.hash;

    if (payload.baseline || isNew || changed || (archiveType === "rollover" && resourceUrl === mainResource)) {
      const destination = await writeArchivedFile(site, archiveFolder, resourceUrl, fileInfo.buffer);
      const relativePath = path.relative(ROOT, destination);
      changes.push({
        url: resourceUrl,
        hash: fileInfo.hash,
        previousHash: previous?.hash || null,
        path: relativePath,
        action: archiveType === "baseline" ? "baseline" : isNew ? "added" : "updated"
      });

      nextArchiveFiles[resourceUrl] = {
        hash: fileInfo.hash,
        path: relativePath
      };
    }

    recordFileState(state, site.id, resourceUrl, fileInfo, nextArchiveFiles[resourceUrl]?.path || null);
  }

  if (mainChanged && previousMainUrl && previousMainUrl !== mainResource) {
    delete nextArchiveFiles[previousMainUrl];
    delete state.files[site.id][previousMainUrl];
  }

  state.archives[site.id].current = {
    folder: archiveFolder,
    mainUrl: mainResource || currentArchive?.mainUrl || null,
    mainFileName: mainFileName || currentArchive?.mainFileName || null,
    files: nextArchiveFiles,
    createdAt: archiveType === "baseline" ? new Date().toISOString() : currentArchive?.createdAt,
    updatedAt: new Date().toISOString(),
    mode: "main-file"
  };

  return {
    archiveType,
    archiveFolder,
    changes,
    failures,
    status: archiveType === "baseline" ? "baseline_archived" : archiveType === "rollover" ? "rolled_archive" : changes.length ? "archived" : "unchanged",
    checked: resources.length
  };
}

async function handleCheck(payload) {
  const config = await readJson(CONFIG_PATH, defaultConfig);
  const state = await readJson(STATE_PATH, defaultState);
  const site = config.sites.find((item) => item.id === payload.siteId);

  if (!site || !site.enabled) {
    return { status: "ignored", reason: "Site is not configured or is disabled." };
  }

  state.checks[site.id] ||= {};
  state.files[site.id] ||= {};
  state.archives ||= {};
  state.archives[site.id] ||= {};

  if (!payload.force && !shouldCheck(state.checks[site.id], site.intervalDays)) {
    return {
      status: "skipped",
      reason: "Site was already checked for the current interval.",
      lastCheck: state.checks[site.id].lastCheck
    };
  }

  const resources = Array.from(new Set(payload.resources || [])).slice(0, 200);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const currentArchive = state.archives[site.id].current || null;
  const mainResource = findMainResource(site, resources);
  const mainFileName = mainResource ? getFileName(mainResource) : null;

  if (!currentArchive && !payload.baseline) {
    return {
      status: "needs_first_archive",
      reason: "Create the first archive before daily tracking starts.",
      checked: 0,
      failures: []
    };
  }

  const { fetched, failures } = await fetchTrackedResources(resources);
  const mode = site.archiveMode || "main-file";
  const archiveResult = mode === "full-copy"
    ? await handleFullCopyArchive({ site, state, resources, fetched, failures, timestamp, currentArchive, payload })
    : await handleMainFileArchive({ site, state, resources, fetched, failures, timestamp, currentArchive, payload, mainResource, mainFileName });

  state.checks[site.id] = {
    lastCheck: todayKey(),
    lastCheckedAt: new Date().toISOString(),
    lastResourceCount: resources.length,
    lastChangeCount: archiveResult.changes.length,
    lastFailureCount: archiveResult.failures.length
  };

  addEvent(state, {
    siteId: site.id,
    siteName: site.name,
    type: archiveResult.archiveType === "baseline" ? "baseline" : archiveResult.archiveType === "rollover" ? "rollover" : archiveResult.archiveType === "full-copy" ? "full-copy" : archiveResult.changes.length ? "archive" : "check",
    changes: archiveResult.changes,
    failures: archiveResult.failures,
    resourceCount: resources.length,
    archiveFolder: archiveResult.archiveFolder
  });

  await writeJson(STATE_PATH, state);

  return {
    status: archiveResult.status,
    archiveFolder: archiveResult.archiveFolder,
    mainFileName: state.archives[site.id].current.mainFileName,
    changes: archiveResult.changes,
    failures: archiveResult.failures,
    checked: archiveResult.checked
  };
}

async function getArchiveStatus(siteId) {
  const config = await readJson(CONFIG_PATH, defaultConfig);
  const state = await readJson(STATE_PATH, defaultState);
  const site = config.sites.find((item) => item.id === siteId);
  const current = state.archives?.[siteId]?.current || null;

  return {
    siteId,
    hasArchive: Boolean(current),
    current,
    archiveRoot: site ? path.relative(ROOT, path.join(ARCHIVE_DIR, slugify(site.name || site.id))) : null
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const ext = path.extname(filePath);
    const file = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(file);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function route(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === "/api/config" && req.method === "GET") {
      sendJson(res, 200, await readJson(CONFIG_PATH, defaultConfig));
      return;
    }

    if (url.pathname === "/api/config" && req.method === "POST") {
      const config = await parseBody(req);
      if (!Array.isArray(config.sites)) {
        sendJson(res, 400, { error: "Config must contain a sites array." });
        return;
      }
      await writeJson(CONFIG_PATH, config);
      sendJson(res, 200, { ok: true, config });
      return;
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      sendJson(res, 200, await readJson(STATE_PATH, defaultState));
      return;
    }

    if (url.pathname === "/api/readme" && req.method === "GET") {
      sendJson(res, 200, { markdown: await fs.readFile(README_PATH, "utf8") });
      return;
    }

    if (url.pathname === "/api/archive-status" && req.method === "GET") {
      sendJson(res, 200, await getArchiveStatus(url.searchParams.get("siteId")));
      return;
    }

    if (url.pathname === "/api/check" && req.method === "POST") {
      sendJson(res, 200, await handleCheck(await parseBody(req)));
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

ensureStorage().then(() => {
  http.createServer(route).listen(PORT, () => {
    console.log(`Web File Tracker Archiver running at http://localhost:${PORT}`);
  });
});
