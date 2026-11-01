// Opens the review page in a new tab when the "Free Review" button on chess.com is clicked.
// (Pages on chess.com can't open extension pages themselves.)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "openReview") return;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(msg.params || {})) if (v) q.set(k, String(v));
  const url = chrome.runtime.getURL("review.html?" + q.toString());
  // a bot game opened from chess.com's game history only to be reviewed: show the review in that same tab
  if (msg.replace && sender.tab) { chrome.tabs.update(sender.tab.id, { url }); return; }
  const opts = { url };
  if (sender.tab) { opts.index = sender.tab.index + 1; opts.openerTabId = sender.tab.id; }
  chrome.tabs.create(opts);
});
