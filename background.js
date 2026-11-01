// Opens the review page in a new tab when the "Free Review" button on chess.com is clicked.
// (Pages on chess.com can't open extension pages themselves.)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "openReview") return;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(msg.params || {})) if (v) q.set(k, String(v));
  const opts = { url: chrome.runtime.getURL("review.html?" + q.toString()) };
  if (sender.tab) { opts.index = sender.tab.index + 1; opts.openerTabId = sender.tab.id; }
  chrome.tabs.create(opts);
});
