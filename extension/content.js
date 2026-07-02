function collectResources() {
  const resources = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => /^https?:\/\//.test(name));

  const fromDom = Array.from(document.querySelectorAll("script[src],link[href]"))
    .map((node) => node.src || node.href)
    .filter(Boolean);

  return Array.from(new Set([...resources, ...fromDom]));
}

chrome.runtime.sendMessage({
  type: "PAGE_VISITED",
  pageUrl: location.href,
  resources: collectResources()
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_RESOURCES") {
    sendResponse({
      pageUrl: location.href,
      resources: collectResources()
    });
  }
});
