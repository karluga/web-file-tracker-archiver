# Web File Tracker Archiver

## Made with

![Codex](https://9to5mac.com/wp-content/uploads/sites/6/2026/05/chatgpt-codex.webp)
**Codex**

Track website files for any changes, saved locally with time-marked archives

- The Chrome extension owns tracked-site configuration.
- The extension detects visits to configured pages and sends matching loaded resources to the local app.
- The local Node app checks each resource hash once per configured interval and archives changed files under `archives/`.
- The local dashboard shows configured sites, last checks, recent archive events, and failures.

## Architecture

```text
Web File Tracker Archiver
|-- Chrome Extension
|   |-- Options page
|   |   |-- Add, edit, and delete tracked sites
|   |   |-- Configure check intervals
|   |   |-- Configure folder, file, and regex rules
|   |   |-- Learn from current page
|   |   `-- Sync config to the local app
|   |-- Popup
|   |   |-- Show local app connection status
|   |   |-- Show tracked-site status
|   |   |-- Create the first archive when no baseline exists
|   |   |-- Scan the active tab on demand
|   |   `-- Open options or dashboard
|   |-- Content script
|   |   |-- Runs on visited pages
|   |   |-- Collects loaded script, style, and network resources
|   |   `-- Sends page visits and resources to the background worker
|   `-- Background service worker
|       |-- Loads config from chrome.storage.local
|       |-- Matches visits against configured page URLs
|       |-- Filters resources using site rules
|       `-- Sends eligible checks to the local Node app
|
|-- Local Node App
|   |-- REST API
|   |   |-- GET  /api/config
|   |   |-- POST /api/config
|   |   |-- GET  /api/state
|   |   `-- POST /api/check
|   |-- Archive engine
|   |   |-- Enforces each site's check interval
|   |   |-- Downloads matching resources
|   |   |-- Computes SHA-256 hashes
|   |   |-- Compares against previous known hashes
|   |   |-- Appends new files into the current archive folder
|   |   |-- Rolls to a new timestamp folder when the main file name changes
|   |   `-- Copies old files forward when a new archive folder is created
|   `-- Dashboard
|       |-- Shows tracked sites
|       |-- Shows last check metadata
|       |-- Shows archived changes
|       `-- Shows fetch failures
|
|-- Local Storage
|   |-- chrome.storage.local
|   |   `-- Extension-owned source of truth for editable config
|   |-- data/config.json
|   |   `-- Local app mirror of extension config
|   |-- data/state.json
|   |   `-- Last checks, known hashes, current archive folders, and recent events
|   `-- archives/
|       `-- Timestamped copies of changed files
|
`-- Daily Flow
    |-- You visit a configured page
    |-- Extension collects loaded resources
    |-- Background worker filters resources by rules
    |-- If no baseline exists, the popup shows First Archive
    |-- After baseline, the local app skips if already checked today
    |-- Local app downloads resources on first eligible visit
    |-- If the main file name is unchanged, new files are appended to the current folder
    |-- If the main file name changed, old files are copied into a new timestamp folder
    |-- The old main file is replaced by the new main file
    `-- Today's check date is recorded
```

## Run the local app

```powershell
npm start
```

Then open:

```text
http://localhost:4177
```

## Load the extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the `extension/` folder from this repo.

Open the extension options page to add or edit tracked sites. Use **Sync to Local App** after changing settings so the dashboard and archive API receive the same configuration.

## Tracking rules

Each site has a page URL, an interval, and one or more rules.

Page matching ignores query strings and hashes. For a private or session-specific URL like:

```text
https://example-website.com/index.html?PRIVATE_QUERY_PARAMETERS=...
```

configure only the stable page URL:

```text
https://example-website.com/index.html
```

- `folder`: matches resource path prefixes such as `/js/`.
- `file`: matches a full path such as `/js/main.js`.
- `regex`: matches the resource filename, useful for hashed bundles like `^main\\..*\\.js$`.

Each site also has a main file pattern. The default is:

```text
^main\..*\.js$
```

That pattern identifies the bundle that decides whether a new timestamped archive folder is needed. If the main filename stays the same, newly discovered files are added to the current archive folder. If the main filename changes, the app creates a new timestamped folder, copies the previous archive into it, removes the old main file, and writes the new main file plus any new or changed files.

Set the interval to:

- `0` for every visit.
- `1` for once per day.
- `7` for once per week.

## Archive output

Changed files are written to:

```text
archives/<site-name>/<timestamp>/<resource-path>
```

Hashes, check state, and recent events are stored in:

```text
data/state.json
```

The extension configuration is stored in `chrome.storage.local` and mirrored to:

```text
data/config.json
```
