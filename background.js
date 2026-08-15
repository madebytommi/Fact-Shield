// background.js — FactShield Free Service Worker
// Handles state, logging, and Google Fact Check Tools API queries

const GOOGLE_FACT_CHECK_API = "https://factchecktools.googleapis.com/v1alpha1/claims:search";

// In-memory cache to avoid hammering the API (per session / short-lived)
const claimCache = new Map(); // key: sentence.trim().toLowerCase() → { rating, reviewUrl, publisher }

function getBadgeText(count, hasStrongWarning) {
  if (count <= 0) {
    return '0';
  }

  const safeCount = count > 9 ? '9+' : String(count);
  return hasStrongWarning ? `${safeCount}!` : safeCount;
}

function clearBadgeForTab(tabId) {
  if (typeof tabId !== 'number') {
    return;
  }

  chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  chrome.action.setTitle({ title: 'FactShield Free', tabId }).catch(() => {});
}

function updateBadgeForTab(tabId, claimCount = 0, strongCount = 0) {
  if (typeof tabId !== 'number') {
    return;
  }

  const hasStrongWarning = strongCount > 0;
  const badgeColor = hasStrongWarning
    ? '#f44336'
    : claimCount > 0
      ? '#ffca28'
      : '#757575';
  const displayCount = hasStrongWarning ? strongCount : claimCount;
  const badgeText = getBadgeText(displayCount, hasStrongWarning);
  const badgeTitle = claimCount > 0
    ? `FactShield: ${claimCount} claim${claimCount === 1 ? '' : 's'} detected${hasStrongWarning ? ` (${strongCount} strong warning${strongCount === 1 ? '' : 's'})` : ''}`
    : 'FactShield: no claims detected';

  chrome.action.setBadgeText({ text: badgeText, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId }).catch(() => {});
  chrome.action.setTitle({ title: badgeTitle, tabId }).catch(() => {});
}

function normalizeFlagRecord(flag = {}, sender) {
  const reason = flag.reason || {};
  const pageUrl = flag.pageUrl || sender.tab?.url || 'Unknown';
  const legacySummary = 'This flag was stored before detailed reason tracking was added.';
  const summary = reason.summary || flag.explanation || legacySummary;
  const hasDetailedReason = Boolean(reason.summary) || (Array.isArray(reason.triggers) && reason.triggers.length > 0);

  return {
    sentence: flag.sentence || flag.claim || 'Unknown sentence',
    claim: flag.sentence || flag.claim || 'Unknown sentence',
    rating: flag.rating || 'Potential Factual Claim',
    explanation: flag.explanation || reason.summary || legacySummary,
    sourceType: flag.sourceType || 'generic',
    publisher: flag.publisher || 'FactShield',
    sourceUrl: flag.sourceUrl || flag.url || flag.reviewUrl || '#',
    pageUrl,
    url: pageUrl,
    originalClaim: flag.originalClaim || null,
    reason: {
      summary,
      ruleName: reason.ruleName || (hasDetailedReason ? flag.rating || 'FactShield rule' : 'Legacy stored flag'),
      score: typeof reason.score === 'number' ? reason.score : null,
      matchedTerms: Array.isArray(reason.matchedTerms) ? reason.matchedTerms : [],
      triggers: Array.isArray(reason.triggers) ? reason.triggers : []
    },
    manual: Boolean(flag.manual) || false, // NEW: Manual Claim Checker
    timestamp: flag.timestamp || new Date().toISOString()
  };
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("FactShield Free installed. Initializing storage.");
  chrome.storage.local.get(['isActive', 'blockedDomains', 'recentFlags', 'manualEnabled'], (result) => {
    if (result.isActive === undefined) {
      chrome.storage.local.set({
        isActive: true,
        blockedDomains: [],
        recentFlags: [],
        manualEnabled: true // NEW: Manual Claim Checker
      });
    }
  });

  // NEW: Manual Claim Checker context menu
  chrome.contextMenus.create({
    id: "factshield-manual-check",
    title: "Fact Check in FACTSHIELD",
    contexts: ["selection", "link"]
  });
});

// NEW: Manual Claim Checker listeners
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "factshield-manual-check") {
    const textToCheck = info.selectionText || info.linkUrl;
    if (textToCheck) {
      chrome.tabs.sendMessage(tab.id, { action: "triggerManualCheck", text: textToCheck }).catch(() => {});
    }
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "factshield-manual-check") {
    chrome.tabs.sendMessage(tab.id, { action: "triggerManualCheck" }).catch(() => {});
  }
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Popup asking for toggle status
  if (request.action === 'getStatus') {
    chrome.storage.local.get(['isActive', 'blockedDomains'], (result) => {
      sendResponse({
        isActive: result.isActive !== false,
        blockedDomains: result.blockedDomains || []
      });
    });
    return true; // async response
  }

  if (request.action === 'updateBadge') {
    updateBadgeForTab(sender.tab?.id, request.claimCount || 0, request.strongCount || 0);
    sendResponse({ status: 'badge-updated' });
    return true;
  }

  if (request.action === 'clearBadge') {
    clearBadgeForTab(sender.tab?.id);
    sendResponse({ status: 'badge-cleared' });
    return true;
  }

  // 2. Content script logging a flag (for recent flags list)
  if (request.action === 'logFlag') {
    chrome.storage.local.get(['recentFlags'], (result) => {
      let flags = result.recentFlags || [];
      flags.unshift(normalizeFlagRecord(request.flag || {
        claim: request.claim,
        explanation: request.explanation
      }, sender));
      // Keep only last 10
      if (flags.length > 10) flags = flags.slice(0, 10);
      chrome.storage.local.set({ recentFlags: flags });
      sendResponse({ status: 'logged' });
    });
    return true;
  }

  // 3. New: Content script asking to check a claim sentence against Google Fact Check API
  if (request.action === 'checkClaim') {
    const sentence = request.sentence?.trim();
    if (!sentence || sentence.length < 20) {
      sendResponse({ match: null, error: 'sentence too short' });
      return true;
    }

    const cacheKey = sentence.toLowerCase();

    // 1. Check short-term in-memory cache first
    if (claimCache.has(cacheKey)) {
      const cached = claimCache.get(cacheKey);
      sendResponse({ match: cached });
      return true;
    }

    // 2. Query Google Fact Check Tools API
    const params = new URLSearchParams({
      query: sentence,
      languageCode: 'en',
      maxAgeDays: 180,          // look back ~6 months for relevance
      pageSize: 5               // we only need a few good matches
    });

    const url = `${GOOGLE_FACT_CHECK_API}?${params.toString()}&key=AIzaSyCcFqzYpYe61VJGaFevw0wXzDA6ESjt_nI`;

    fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    })
      .then(response => {
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        return response.json();
      })
      .then(data => {
        let bestMatch = null;

        // Look for the strongest negative rating
        if (data.claims && data.claims.length > 0) {
          for (const claim of data.claims) {
            const rating = claim.claimReview?.[0]?.textualRating?.toLowerCase() || '';
            const isNegative =
              rating.includes('false') ||
              rating.includes('misleading') ||
              rating.includes('mostly false') ||
              rating.includes('pants on fire') ||
              rating.includes('inaccurate');

            if (isNegative) {
              const review = claim.claimReview[0];
              bestMatch = {
                rating: review.textualRating,
                explanation: review.title || claim.text || "Claim rated negatively",
                publisher: review.publisher?.name || "Fact-check source",
                reviewUrl: review.url,
                sourceUrl: review.url,
                originalClaim: claim.text,
                reason: {
                  summary: `Matched a ${review.publisher?.name || 'fact-check'} review rated "${review.textualRating}".`,
                  ruleName: 'Google Fact Check API match',
                  score: isNegative ? 0.9 : 0.5,
                  matchedTerms: claim.text ? [claim.text] : [],
                  triggers: [
                    {
                      label: 'Matched claim',
                      value: claim.text || sentence,
                      weight: isNegative ? 0.9 : 0.5
                    },
                    {
                      label: 'Fact-check rating',
                      value: review.textualRating
                    }
                  ]
                }
              };
              break; // take the first strong negative match
            }
          }
        }

        // Cache the result (even if no match) for ~10 minutes
        claimCache.set(cacheKey, bestMatch);
        setTimeout(() => claimCache.delete(cacheKey), 10 * 60 * 1000);

        sendResponse({ match: bestMatch });
      })
      .catch(err => {
        console.error("Fact check API error:", err);
        sendResponse({ match: null, error: err.message });
      });

    return true; // keep channel open for async fetch
  }

  // NEW: OpenRouter AI Deep Analysis
  if (request.action === 'aiFactCheck') {
    chrome.storage.local.get(['openrouterApiKey'], (res) => {
      const apiKey = res.openrouterApiKey;
      if (!apiKey) {
        sendResponse({ error: 'AI analysis requires OpenRouter API key (free)' });
        return;
      }

      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: request.model || "openrouter/free",
          messages: [
            {
              role: "system",
              content: "You are a neutral fact-checker. Respond ONLY in valid JSON: {\"verdict\": \"True/False/Mixed\", \"confidence\": 0-100, \"explanation\": \"short 1-2 sentence explanation\", \"sources\": [\"url1\", \"url2\"]}"
            },
            {
              role: "user",
              content: `Is this claim true? Claim: ${request.sentence}`
            }
          ]
        })
      })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error.message || "API Error");
        const content = data.choices?.[0]?.message?.content || "{}";
        try {
            let jsonString = content;
            if (jsonString.startsWith('```json')) jsonString = jsonString.replace(/^```json/, '').replace(/```$/, '').trim();
            else if (jsonString.startsWith('```')) jsonString = jsonString.replace(/^```/, '').replace(/```$/, '').trim();
            const parsed = JSON.parse(jsonString);
            sendResponse({ result: parsed });
        } catch (e) {
            console.error("Failed to parse AI response:", content);
            sendResponse({ error: "Failed to parse AI response. It may not have been valid JSON." });
        }
      })
      .catch(err => {
        console.error("OpenRouter API error:", err);
        sendResponse({ error: err.message });
      });
    });
    return true; // async
  }

  // Unknown action
  sendResponse({ error: 'unknown action' });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    clearBadgeForTab(tabId);
  }
});

// Optional: Clear old cache entries periodically (service worker can be terminated)
setInterval(() => {
  if (claimCache.size > 200) {
    claimCache.clear(); // simple safety valve
  }
}, 30 * 60 * 1000);
