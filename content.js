// content.js — FactShield Free (Claim Highlighter & Source Alert)
// Highlights potential factual claims + encourages verification
// Privacy-first, local-first, with optional Google Fact Check API fallback

console.log("FactShield Free: Claim Highlighter loaded.");

let isActive = true;
let isBlocked = false;
let isScanning = false;
let pageObserver = null;
const CHECK_DELAY_MS = 600;       // debounce
const MAX_HIGHLIGHTS_PER_PAGE = 15;
const CLAIM_SCORE_THRESHOLD = 2.5;
const MIN_SENTENCE_LENGTH = 35;
let highlightsApplied = 0;
let claimCount = 0;
let strongCount = 0;

// Tooltip singleton
let tooltip = null;
let activeHighlightSpan = null;
const processedClaimKeys = new Set();
const loggedClaimKeys = new Set();
let currentPageUrl = window.location.href;
let badgeUpdateTimeout = null;
let manualEnabled = true; // NEW: Manual Claim Checker
let manualButtonTimeout = null; // NEW: Manual Claim Checker

window.ignoredClaimsSet = window.ignoredClaimsSet || new Set();

const AI_DOMAIN_PATTERN = /gemini\.google\.com|claude\.ai|chat\.openai\.com|copilot\.microsoft\.com|bing\.com\/chat|grok\.x\.ai|perplexity\.ai|you\.com|chatgpt\.com|poe\.com/i;
const FACT_CHECK_EXPLORER_SEARCH_URL = "https://toolbox.google.com/factcheck/explorer/search";

const HEURISTIC_RULES = [
    {
        id: "numeric-claim",
        label: "Contains a number, year, or percentage",
        weight: 2,
        pattern: /\d{4}|\d+%|\d+/
    },
    {
        id: "attribution-language",
        label: "Uses factual attribution language",
        weight: 2,
        pattern: /(said|claimed|reported|according to|stated|revealed|proven|confirmed|debunked)/i
    },
    {
        id: "absolute-language",
        label: "Uses absolute or high-certainty wording",
        weight: 1.5,
        pattern: /(all|none|everyone|no one|always|never|rampant|zero|record|massive)/i
    },
    {
        id: "named-entity",
        label: "Mentions a likely proper name",
        weight: 1,
        matcher: findNamedEntityMatch
    }
];

const ENTITY_HONORIFICS = new Set([
    "Mr", "Mrs", "Ms", "Dr", "Prof", "President", "Pres", "Senator", "Sen", "Governor", "Gov",
    "Representative", "Rep", "Secretary", "Sec", "General", "Gen", "Captain", "Capt", "Colonel", "Col"
]);

const HEADLINE_FRAGMENT_WORDS = new Set([
    "Attack", "Attacks", "Bomb", "Blast", "Breaking", "Coverage", "Exclusive", "Guide", "Headline",
    "Headlines", "Live", "News", "Photo", "Photos", "Picture", "Pictures", "Report", "Reports",
    "Story", "Stories", "Update", "Updates", "Video", "Videos", "Watch"
]);

function isTitleCaseWord(word) {
    return /^[A-Z][a-z]+(?:['-][A-Z]?[a-z]+)*$/.test(word) || /^[A-Z]{2,}$/.test(word);
}

function stripWrappingPunctuation(text) {
    return text.replace(/^["'`([{\s]+|["'`),\].!?\s]+$/g, "");
}

function sentenceLooksLikeHeadline(text) {
    const alphaWords = text.match(/\b[A-Za-z][A-Za-z'-]*\b/g) || [];
    if (alphaWords.length < 3) {
        return false;
    }

    const titleCaseWords = alphaWords.filter(isTitleCaseWord);
    return titleCaseWords.length / alphaWords.length >= 0.6;
}

function isLikelyHeadlineFragment(candidateWords) {
    if (candidateWords.length === 0) {
        return false;
    }

    const meaningfulWords = candidateWords.filter((word) => !ENTITY_HONORIFICS.has(word));
    if (meaningfulWords.length === 0) {
        return true;
    }

    return meaningfulWords.every((word) => HEADLINE_FRAGMENT_WORDS.has(word));
}

function findNamedEntityMatch(text) {
    const candidatePattern = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|President|Pres|Senator|Sen|Governor|Gov|Representative|Rep|Secretary|Sec|General|Gen|Captain|Capt|Colonel|Col)\.?\s+)?(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,})){1,2}/g;
    const headlineLikeSentence = sentenceLooksLikeHeadline(text);

    for (const rawMatch of text.matchAll(candidatePattern)) {
        const candidate = stripWrappingPunctuation(rawMatch[0]);
        const candidateWords = candidate.replace(/\./g, "").split(/\s+/).filter(Boolean);
        const meaningfulWords = candidateWords.filter((word) => !ENTITY_HONORIFICS.has(word));

        if (meaningfulWords.length < 2) {
            continue;
        }

        if (isLikelyHeadlineFragment(candidateWords)) {
            continue;
        }

        const lastWord = meaningfulWords[meaningfulWords.length - 1];
        if (HEADLINE_FRAGMENT_WORDS.has(lastWord) && !candidateWords.some((word) => ENTITY_HONORIFICS.has(word))) {
            continue;
        }

        if (headlineLikeSentence && rawMatch.index === 0 && meaningfulWords.length <= 2) {
            continue;
        }

        return {
            text: candidate,
            pattern: candidatePattern.toString()
        };
    }

    return null;
}

function isKnownAIDomain(hostname = window.location.hostname) {
    return AI_DOMAIN_PATTERN.test(hostname);
}

function dedupeList(values) {
    return [...new Set(values.filter(Boolean))];
}

function getKeywordHits(text, keywords = []) {
    const lowerText = text.toLowerCase();
    return keywords.filter((keyword) => lowerText.includes(keyword.toLowerCase()));
}

function normalizeClaimKey(text) {
    return text
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function clearBadge() {
    sendRuntimeMessage({ action: "clearBadge" });
}

function queueBadgeUpdate() {
    clearTimeout(badgeUpdateTimeout);
    badgeUpdateTimeout = window.setTimeout(() => {
        sendRuntimeMessage({
            action: "updateBadge",
            claimCount,
            strongCount
        });
    }, 150);
}

function getIgnoredClaimsSet() {
    return window.ignoredClaimsSet;
}

function loadIgnoredClaims(callback) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
        callback();
        return;
    }

    chrome.storage.local.get(["ignoredClaims"], (result) => {
        const ignoredClaims = Array.isArray(result?.ignoredClaims) ? result.ignoredClaims : [];
        window.ignoredClaimsSet = new Set(ignoredClaims.map((claim) => normalizeClaimKey(claim)).filter(Boolean));
        callback();
    });
}

function persistIgnoredClaim(claimKey) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
        return;
    }

    chrome.storage.local.get(["ignoredClaims"], (result) => {
        const ignoredClaims = Array.isArray(result?.ignoredClaims) ? result.ignoredClaims : [];
        if (ignoredClaims.includes(claimKey)) {
            return;
        }

        ignoredClaims.push(claimKey);
        while (ignoredClaims.length > 500) {
            ignoredClaims.shift();
        }

        chrome.storage.local.set({ ignoredClaims });
    });
}

function unwrapHighlight(span) {
    if (!span?.parentNode) {
        return;
    }

    const textNode = document.createTextNode(span.textContent || "");
    span.parentNode.replaceChild(textNode, span);
}

function showIgnoredConfirmation() {
    if (!tooltip) {
        return;
    }

    tooltip.innerHTML = `
      <div class="fs-tooltip-header fs-tooltip-success">Ignored</div>
      <div class="fs-tooltip-body">This sentence will not be flagged again.</div>
      <div class="fs-tooltip-ignored-badge">Ignored</div>
    `;

    clearTimeout(window.fsTooltipHide);
    window.fsTooltipHide = setTimeout(() => {
        if (tooltip) {
            tooltip.style.display = "none";
        }
    }, 3000);
}

function normalizeFactCheckSearchText(text) {
    return String(text || "")
        .replace(/\s+/g, " ")
        .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
        .trim();
}

function shortenClaimForFactCheckSearch(sentence, maxLength = 160) {
    const normalizedSentence = normalizeFactCheckSearchText(sentence);
    if (!normalizedSentence) {
        return "";
    }

    if (normalizedSentence.length <= maxLength) {
        return normalizedSentence;
    }

    const clauses = normalizedSentence
        .split(/(?<=[,;:])\s+|\s+[\u2013\u2014-]\s+/)
        .map((clause) => clause.trim())
        .filter(Boolean);
    const bestClause = clauses.find((clause) => clause.length >= 60 && clause.length <= maxLength);
    if (bestClause) {
        return bestClause;
    }

    const truncated = normalizedSentence.slice(0, maxLength + 1);
    const cutIndex = truncated.lastIndexOf(" ");
    if (cutIndex >= 100) {
        return truncated.slice(0, cutIndex).trim();
    }

    return normalizedSentence.slice(0, maxLength).trim();
}

function buildFactCheckExplorerUrl(sentence) {
    const searchQuery = shortenClaimForFactCheckSearch(sentence);
    if (!searchQuery) {
        return "";
    }

    return `${FACT_CHECK_EXPLORER_SEARCH_URL}?query=${encodeURIComponent(searchQuery)}`;
}

function showFactCheckSearchConfirmation() {
    const statusNode = tooltip?.querySelector(".fs-tooltip-search-status");
    if (statusNode) {
        statusNode.textContent = "Opening fact-check search...";
        statusNode.hidden = false;
    }

    clearTimeout(window.fsTooltipHide);
    window.fsTooltipHide = setTimeout(() => {
        activeHighlightSpan = null;
        if (tooltip) {
            tooltip.style.display = "none";
        }
    }, 2000);
}

// IMPROVED: Smart multi-site fact-check lookup - prioritizes direct API links
function handleFactCheckSearch() {
    const span = activeHighlightSpan;
    if (!span) {
        return;
    }

    const claimData = span.dataset.fsClaim;
    if (!claimData) {
        return;
    }

    try {
        const claim = JSON.parse(claimData);
        
        // Priority: Direct source/review link exists
        const directUrl = claim.reviewUrl || claim.sourceUrl;
        if (directUrl && directUrl !== "#" && !directUrl.includes("search/?q=")) {
            const factCheckTab = window.open(directUrl, "_blank", "noopener,noreferrer");
            if (factCheckTab) factCheckTab.focus();
            console.log("FactShield Free: opening direct fact-check url", directUrl);
            showFactCheckSearchConfirmation();
            return;
        }

        // Fallback: Smart multi-site search using exact sentence
        const sentence = claim.sentence || claim.originalClaim || span.textContent || "";
        const query = encodeURIComponent(normalizeFactCheckSearchText(sentence));
        if (!query) return;

        window.open(`https://www.politifact.com/search/?q=${query}`, "_blank", "noopener,noreferrer");
        window.open(`https://www.snopes.com/search/?q=${query}`, "_blank", "noopener,noreferrer");
        window.open(`https://www.factcheck.org/search/?q=${query}`, "_blank", "noopener,noreferrer");
        window.open(`https://www.reuters.com/fact-check/search/?query=${query}`, "_blank", "noopener,noreferrer");

        console.log("FactShield Free: opening multi-site fact-check search");
        showFactCheckSearchConfirmation();
    } catch (error) {
        console.error("FactShield Free: failed to open fact-check search.", error);
    }
}

function handleIgnore() {
    const span = activeHighlightSpan;
    if (!span) {
        return;
    }

    const claimData = span.dataset.fsClaim;
    if (!claimData) {
        return;
    }

    try {
        const claim = JSON.parse(claimData);
        const claimKey = normalizeClaimKey(claim.sentence || span.textContent || "");
        if (!claimKey) {
            return;
        }

        getIgnoredClaimsSet().add(claimKey);
        processedClaimKeys.add(claimKey);
        loggedClaimKeys.add(claimKey);
        persistIgnoredClaim(claimKey);
        console.log("FactShield Free: ignored claim", claimKey);

        unwrapHighlight(span);
        activeHighlightSpan = null;
        showIgnoredConfirmation();
    } catch (error) {
        console.error("FactShield Free: failed to ignore claim.", error);
    }
}

function refreshPageStateIfNeeded() {
    if (window.location.href === currentPageUrl) {
        return;
    }

    clearBadge();
    currentPageUrl = window.location.href;
    highlightsApplied = 0;
    claimCount = 0;
    strongCount = 0;
    processedClaimKeys.clear();
    loggedClaimKeys.clear();
}

function splitIntoSentences(text) {
    const normalizedText = text
        .replace(/\s+/g, " ")
        .trim();

    if (!normalizedText) {
        return [];
    }

    const protectedText = normalizedText
        .replace(/\.\.\./g, "__ELLIPSIS__")
        .replace(/\b(?:[A-Za-z]\.){2,}/g, (match) => match.replace(/\./g, "__DOT__"))
        .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|Gen|Sen|Rep|Gov|Lt|Col|Capt|Cmdr|Sgt|Adm|Maj|Ave|Blvd|Rd|No|Nos|Dept|Univ|Inc|Ltd|Co|Corp|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|etc|vs|e\.g|i\.e)\./gi, (match) => match.replace(/\./g, "__DOT__"))
        .replace(/(\d)\.(\d)/g, "$1__DECIMAL__$2")
        .replace(/(^|\s)(\d+)\.(?=\s+[A-Z])/g, "$1$2__LIST__");

    const fragments = protectedText.match(/.+?(?:[.!?]+(?=(?:["')\]]*\s+|$))|$)/g) || [];

    return fragments
        .map((fragment) => fragment
            .replace(/__ELLIPSIS__/g, "...")
            .replace(/__DECIMAL__/g, ".")
            .replace(/__LIST__/g, ".")
            .replace(/__DOT__/g, ".")
            .trim())
        .filter((sentence) => sentence.length >= MIN_SENTENCE_LENGTH);
}

function analyzeHeuristicSignals(text) {
    let score = 0;
    const matchedRules = [];

    for (const rule of HEURISTIC_RULES) {
        const customMatch = typeof rule.matcher === "function" ? rule.matcher(text) : null;
        const regexMatch = !customMatch && rule.pattern ? text.match(rule.pattern) : null;
        const matchText = customMatch?.text || regexMatch?.[0];
        const patternText = customMatch?.pattern || rule.pattern?.toString();

        if (!matchText) continue;

        score += rule.weight;
        matchedRules.push({
            id: rule.id,
            label: rule.label,
            weight: rule.weight,
            triggerText: matchText,
            pattern: patternText
        });
    }

    return {
        score: Number(score.toFixed(1)),
        matchedRules
    };
}

function buildHeuristicMatch(sentence, analysis, overrides = {}) {
    const triggers = analysis.matchedRules.map((rule) => ({
        label: rule.label,
        value: rule.triggerText,
        pattern: rule.pattern,
        weight: rule.weight
    }));
    const matchedDescriptions = analysis.matchedRules.map((rule) => `${rule.label} (+${rule.weight})`);
    const summary = matchedDescriptions.length > 0
        ? `Heuristic score ${analysis.score} because ${matchedDescriptions.join(", ")}.`
        : "This sentence appears to make a verifiable statement. Consider checking reliable sources for accuracy.";

    return {
        rating: overrides.rating || "Potential Factual Claim",
        explanation: overrides.explanation || "This sentence appears to make a verifiable statement. Consider checking reliable sources for accuracy.",
        publisher: overrides.publisher || "FactShield Alert",
        url: overrides.url || "https://www.politifact.com/search/?q=" + encodeURIComponent(sentence.slice(0, 80)),
        reviewUrl: overrides.reviewUrl,
        originalClaim: overrides.originalClaim,
        reason: {
            summary,
            ruleName: overrides.ruleName || "Heuristic claim detector",
            score: analysis.score,
            matchedTerms: dedupeList(triggers.map((trigger) => trigger.value)),
            triggers
        }
    };
}

function buildFlagPayload(sentence, matchData, sourceType) {
    const reason = matchData.reason || {};
    return {
        sentence,
        sourceType,
        rating: matchData.rating || "Potential Factual Claim",
        explanation: matchData.explanation || reason.summary || "Flagged by FactShield",
        publisher: matchData.publisher || "FactShield",
        sourceUrl: matchData.url || matchData.reviewUrl || "#",
        originalClaim: matchData.originalClaim || null,
        reason: {
            summary: reason.summary || matchData.explanation || "Flagged by FactShield",
            ruleName: reason.ruleName || "FactShield rule",
            score: typeof reason.score === "number" ? reason.score : null,
            matchedTerms: Array.isArray(reason.matchedTerms) ? reason.matchedTerms : [],
            triggers: Array.isArray(reason.triggers) ? reason.triggers : []
        }
    };
}

function getFriendlyTooltipTitle(claim) {
    if (claim.sourceType === "api" && claim.rating) {
        return claim.rating;
    }

    if (claim.sourceType === "local") {
        return "This claim matches a known misinformation pattern";
    }

    return "This sentence may be worth double-checking";
}

function getFriendlyTooltipIntro(claim) {
    if (claim.sourceType === "api") {
        return claim.explanation || "A published fact-check appears to match this statement.";
    }

    if (claim.sourceType === "local") {
        return claim.explanation || "This wording is similar to a claim that fact-checkers have debunked before.";
    }

    return "FactShield noticed wording patterns that often show up in checkable factual claims.";
}

function getScoreDescription(score) {
    if (typeof score !== "number") return "";
    if (score >= 4) return "Strong signal";
    if (score >= CLAIM_SCORE_THRESHOLD) return "Moderate signal";
    return "Light signal";
}

function formatTriggerLabel(label) {
    const labelMap = {
        "Contains a number, year, or percentage": "It includes a number or date",
        "Uses factual attribution language": "It uses reporting-style wording",
        "Uses absolute or high-certainty wording": "It uses strong certainty words",
        "Mentions a likely proper name": "It mentions a named person, place, or event",
        "Cache pattern": "It matches a known misinformation pattern",
        "Matched claim": "It closely matches a published fact-check",
        "Fact-check rating": "Fact-check result"
    };

    return labelMap[label] || label;
}

function formatTriggerValue(trigger) {
    if (trigger.label === "Fact-check rating") {
        return trigger.value || "";
    }

    if (trigger.value) {
        return `"${trigger.value}"`;
    }

    return "";
}

function buildTooltipReasonMarkup(reason, sourceType) {
    const triggerItems = Array.isArray(reason.triggers) ? reason.triggers : [];
    if (triggerItems.length === 0) {
        return "";
    }

    const intro = sourceType === "api"
        ? "Why it was flagged"
        : "What stood out";
    const scoreDescription = getScoreDescription(reason.score);
    const scoreMarkup = scoreDescription
        ? `<div class="fs-tooltip-score">${scoreDescription}</div>`
        : "";
    const itemsMarkup = triggerItems
        .map((trigger) => {
            const friendlyLabel = formatTriggerLabel(trigger.label || "Trigger");
            const friendlyValue = formatTriggerValue(trigger);
            return `<li><strong>${friendlyLabel}</strong>${friendlyValue ? `: ${friendlyValue}` : ""}</li>`;
        })
        .join("");

    return `
      <div class="fs-tooltip-reason-block">
        <div class="fs-tooltip-reason-title">${intro}</div>
        ${scoreMarkup}
        <ul class="fs-tooltip-reason-list">${itemsMarkup}</ul>
      </div>
    `;
}

function canSendRuntimeMessage() {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id && typeof chrome.runtime.sendMessage === "function";
}

function sendRuntimeMessage(message, callback) {
    if (!canSendRuntimeMessage()) {
        return false;
    }

    try {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime?.lastError) {
                console.warn("FactShield Free: runtime message failed.", chrome.runtime.lastError.message);
                if (typeof callback === "function") {
                    callback(null);
                }
                return;
            }

            if (typeof callback === "function") {
                callback(response ?? null);
            }
        });
        return true;
    } catch (error) {
        console.warn("FactShield Free: runtime messaging unavailable.", error);
        return false;
    }
}

// Init once
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    let stateChanged = false;
    let oldIsActive = isActive;
    let oldIsBlocked = isBlocked;

    if (changes.isActive !== undefined) {
        const newlyActive = changes.isActive.newValue;
        if (newlyActive !== isActive) {
            isActive = newlyActive;
            stateChanged = true;
        }
    }

    if (changes.blockedDomains !== undefined) {
        const hostname = window.location.hostname;
        const newBlockedList = changes.blockedDomains.newValue || [];
        const newlyBlocked = newBlockedList.some(domain => hostname.includes(domain));
        if (newlyBlocked !== isBlocked) {
            isBlocked = newlyBlocked;
            stateChanged = true;
        }
    }

    if (!stateChanged) return;

    // Handle Transitions
    if (isBlocked) {
        // Blocked overrides everything
        stopObserver();
        clearBadge();
        showBlockedBanner();
    } else {
        // Unblocked
        removeBlockedBanner();
        
        if (!isActive) {
            // Disabled
            stopObserver();
            clearBadge();
        } else {
            // Active & Unblocked
            // Only scan if we transitioned from disabled or blocked
            if (!oldIsActive || oldIsBlocked) {
                scanDocument([document.body]);
                setupObserver();
            }
        }
    }
});

function init() {
    tooltip = document.getElementById("factshield-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "factshield-tooltip";
        tooltip.style.display = "none";
        document.body.appendChild(tooltip);
    }

        loadIgnoredClaims(() => {
        const requestedStatus = sendRuntimeMessage({ action: "getStatus" }, (response) => {
            if (response && response.isActive !== undefined) {
                isActive = response.isActive;
            }
            if (response && response.blockedDomains) {
                const hostname = window.location.hostname;
                isBlocked = response.blockedDomains.some(domain => hostname.includes(domain));
            }
            
            // NEW: Manual Claim Checker config
            chrome.storage.local.get(['manualEnabled', 'aiEnabled'], (res) => { // NEW: OpenRouter AI Deep Analysis config
                manualEnabled = res.manualEnabled !== false;
                window.fsAiEnabled = res.aiEnabled !== false; // expose globally

                if (isBlocked) {
                    clearBadge();
                    showBlockedBanner();
                } else if (!isActive) {
                    clearBadge();
                } else {
                    // Start automatic scanner
                    if (document.readyState === "loading") {
                        document.addEventListener("DOMContentLoaded", () => {
                            scanDocument([document.body]);
                            setupObserver();
                        });
                    } else {
                        scanDocument([document.body]);
                        setupObserver();
                    }
                }
            });
        });

        if (!requestedStatus && !isActive) {
            clearBadge();
        }
    });
}

function removeBlockedBanner() {
    const banner = document.getElementById("factshield-blocked-banner");
    if (banner) {
        banner.remove();
        document.body.style.marginTop = "";
    }
}

function showBlockedBanner() {
    if (document.getElementById("factshield-blocked-banner")) return;
    const banner = document.createElement("div");
    banner.id = "factshield-blocked-banner";
    banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        background-color: #ff4d4d;
        color: white;
        text-align: center;
        padding: 12px;
        font-family: system-ui, -apple-system, sans-serif;
        font-weight: bold;
        z-index: 2147483647;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        font-size: 16px;
    `;
    banner.textContent = "⚠️ FactShield: This domain is on your blocked list. Fact-checking is disabled for this site.";
    document.body.appendChild(banner);
    document.body.style.marginTop = "48px";
}

// Watch for new content (social feeds, infinite scroll, etc.)
function setupObserver() {
    if (pageObserver) return;

    pageObserver = new MutationObserver((mutations) => {
        if (!isActive || isScanning || highlightsApplied >= MAX_HIGHLIGHTS_PER_PAGE) return;

        let addedNodes = [];
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
                    addedNodes.push(node);
                }
            });
        });

        if (addedNodes.length > 0) {
            clearTimeout(window.fsScanTimeout);
            window.fsScanTimeout = setTimeout(() => scanDocument(addedNodes), CHECK_DELAY_MS);
        }
    });

    pageObserver.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
    if (!pageObserver) return;
    pageObserver.disconnect();
    pageObserver = null;
}

// Scan page → extract candidate sentences → process
function scanDocument(nodesToScan) {
    refreshPageStateIfNeeded();

    if (isScanning || highlightsApplied >= MAX_HIGHLIGHTS_PER_PAGE) return;
    isScanning = true;

    try {
        const candidates = [];

        nodesToScan.forEach(rootNode => {
            if (!rootNode.parentNode) return;

            if (rootNode.nodeType === Node.TEXT_NODE) {
                evaluateNode(rootNode, candidates);
            } else if (rootNode.nodeType === Node.ELEMENT_NODE) {
                const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
                let node;
                while ((node = walker.nextNode())) {
                    evaluateNode(node, candidates);
                }
            }
        });

        // Sort by score descending, take top N
        candidates.sort((a, b) => b.score - a.score);
        const toProcess = candidates.slice(0, MAX_HIGHLIGHTS_PER_PAGE - highlightsApplied);

        toProcess.forEach(({ node, text }) => processClaim(node, text));
    } finally {
        isScanning = false;
        queueBadgeUpdate();
    }
}

function evaluateNode(node, candidates) {
    const parent = node.parentNode;
    if (!parent) return;

    // Skip scripts, styles, already highlighted, tooltip
    if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' ||
        parent.tagName === 'NOSCRIPT' || parent.classList.contains('factshield-highlight') ||
        parent.id === 'factshield-tooltip') {
        return;
    }

    const text = node.nodeValue.trim();
    if (text.length < MIN_SENTENCE_LENGTH) return;

    // Fast path: check if any sentence matches a known local pattern
    let localCacheHit = false;
    const sentences = splitIntoSentences(text);
    for (const sentence of sentences) {
        if (hasLocalCacheMatch(sentence)) {
            localCacheHit = true;
            break;
        }
    }

    const analysis = analyzeHeuristicSignals(text);
    const score = analysis.score;

    // Allow node if it matches local cache OR meets generic threshold
    if (localCacheHit || score >= CLAIM_SCORE_THRESHOLD) {
        const effectiveScore = localCacheHit ? Math.max(score, CLAIM_SCORE_THRESHOLD + 1) : score;
        candidates.push({ node, text, score: effectiveScore });
    }
}

// Process one text node: split sentences → skip meta → check local → optional API → highlight
function processClaim(textNode, fullText) {
    if (highlightsApplied >= MAX_HIGHLIGHTS_PER_PAGE) return;

    const parentEl = textNode.parentNode;
    if (!parentEl) return;

    const sentences = splitIntoSentences(fullText);

    for (const sentence of sentences) {
        if (highlightsApplied >= MAX_HIGHLIGHTS_PER_PAGE) {
            return;
        }

        const analysis = analyzeHeuristicSignals(sentence);
        const claimKey = normalizeClaimKey(sentence);

        // Skip our own meta-description sentences to avoid self-highlighting loop
        // This prevents highlighting explanations about FactShield, fuzzysort, extension code, etc.
        if (/factshield|fuzzysort|content\.js|background\.js|chrome\.runtime|manifest|extension|heuristic|cache\.js/i.test(sentence.toLowerCase())) {
            continue; // skip this sentence entirely
        }

        if (!claimKey || processedClaimKeys.has(claimKey)) {
            continue;
        }

        if (getIgnoredClaimsSet().has(claimKey)) {
            processedClaimKeys.add(claimKey);
            continue;
        }

        processedClaimKeys.add(claimKey);

        const localMatch = checkLocalCache(sentence, analysis);
        if (localMatch) {
            highlightClaim(parentEl, sentence, localMatch, "local", claimKey);
            continue; // we highlighted — move to next sentence
        }

        if (analysis.score < CLAIM_SCORE_THRESHOLD) {
            continue; // skip low-signal sentences inside high-signal text nodes
        }

        // Send to background for Google Fact Check API
        const sent = sendRuntimeMessage({ action: "checkClaim", sentence }, (response) => {
            if (response?.match) {
                // API found something — highlight with API data
                highlightClaim(parentEl, sentence, response.match, "api", claimKey);
            } else {
                // No specific match → gentle generic warning
                const generic = buildHeuristicMatch(sentence, analysis);
                highlightClaim(parentEl, sentence, generic, "generic", claimKey);
            }
        });

        if (!sent) {
            const generic = buildHeuristicMatch(sentence, analysis);
            highlightClaim(parentEl, sentence, generic, "generic", claimKey);
        }
    }
}

function hasLocalCacheMatch(sentence) {
    if (!window.factCache) return false;

    for (const item of window.factCache) {
        const keywordHits = getKeywordHits(sentence, item.keywords);
        const patternMatch = item.pattern ? sentence.match(item.pattern) : null;
        const keywordThreshold = Math.min(2, item.keywords?.length || 0);
        const hasKeywordSupport = keywordHits.length >= keywordThreshold || (keywordHits.length > 0 && !!patternMatch);

        if (patternMatch || hasKeywordSupport) {
            return true;
        }
    }
    return false;
}

function checkLocalCache(sentence, analysis) {
    if (!window.factCache) return null;

    let bestMatch = null;

    for (const [index, item] of window.factCache.entries()) {
        const keywordHits = getKeywordHits(sentence, item.keywords);
        const patternMatch = item.pattern ? sentence.match(item.pattern) : null;
        const keywordThreshold = Math.min(2, item.keywords?.length || 0);
        const hasKeywordSupport = keywordHits.length >= keywordThreshold || (keywordHits.length > 0 && !!patternMatch);

        if (!patternMatch && !hasKeywordSupport) {
            continue;
        }

        const localScore = (patternMatch ? 2 : 0) + Math.min(keywordHits.length * 0.75, 2);
        const matchedTerms = dedupeList([
            ...(patternMatch ? [patternMatch[0]] : []),
            ...keywordHits
        ]);
        const triggers = [];

        if (keywordHits.length > 0) {
            triggers.push({
                label: "Matched keywords",
                value: keywordHits.join(", "),
                weight: Number(Math.min(keywordHits.length * 0.75, 2).toFixed(2))
            });
        }

        if (patternMatch) {
            triggers.push({
                label: "Cache pattern",
                value: patternMatch[0],
                pattern: item.pattern.toString(),
                weight: 2
            });
        }

        const candidateMatch = {
            rating: "Common Misinformation Pattern",
            explanation: item.explanation,
            publisher: item.sources?.[0]?.name || "Cached Source",
            url: item.sources?.[0]?.url || "#",
            reason: {
                summary: patternMatch
                    ? `This sentence matched a known claim pattern and ${keywordHits.length} related keyword${keywordHits.length === 1 ? "" : "s"}.`
                    : `This sentence matched ${keywordHits.length} related keyword${keywordHits.length === 1 ? "" : "s"} from a known misinformation pattern.`,
                ruleName: item.label || `Local cache rule ${index + 1}`,
                score: Number(Math.max(analysis.score, localScore, CLAIM_SCORE_THRESHOLD).toFixed(2)),
                matchedTerms,
                triggers
            },
            localScore
        };

        if (!bestMatch || candidateMatch.localScore > bestMatch.localScore) {
            bestMatch = candidateMatch;
        }
    }

    if (!bestMatch) {
        return null;
    }

    delete bestMatch.localScore;
    return bestMatch;
}

// Apply highlight + store data for tooltip
function highlightClaim(parentEl, matchText, matchData, sourceType, claimKey = normalizeClaimKey(matchText)) {
    if (!parentEl || !parentEl.isConnected) return;

    if (!claimKey || highlightsApplied >= MAX_HIGHLIGHTS_PER_PAGE) return;
    if (getIgnoredClaimsSet().has(claimKey)) return;

    let targetNode = null;
    let idx = -1;
    let content = "";

    for (const child of Array.from(parentEl.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            content = child.nodeValue;
            idx = content.indexOf(matchText);
            if (idx !== -1) {
                targetNode = child;
                break;
            }
        }
    }

    if (!targetNode) return;

    const before = document.createTextNode(content.slice(0, idx));
    const after = document.createTextNode(content.slice(idx + matchText.length));

    const span = document.createElement("span");

    const flagPayload = buildFlagPayload(matchText, matchData, sourceType);
    const isAIDomain = isKnownAIDomain();
    span.className = `factshield-highlight ${isAIDomain ? 'mild' : ''} ${sourceType === "api" && matchData.rating?.includes("False") ? "strong-warning" : ""}`;
    span.textContent = matchText;

    // Store for tooltip
    span.dataset.fsClaim = JSON.stringify(flagPayload);

    span.addEventListener("mouseenter", showTooltip);
    span.addEventListener("mouseleave", hideTooltip);

    parentEl.insertBefore(before, targetNode);
    parentEl.insertBefore(span, targetNode);
    parentEl.insertBefore(after, targetNode);
    parentEl.removeChild(targetNode);

    highlightsApplied++;
    claimCount++;
    if (span.classList.contains("strong-warning")) {
        strongCount++;
    }
    queueBadgeUpdate();

    // Log to popup recent flags
    if (!loggedClaimKeys.has(claimKey)) {
        loggedClaimKeys.add(claimKey);
        sendRuntimeMessage({
            action: "logFlag",
            flag: {
                ...flagPayload,
                pageUrl: window.location.href
            }
        });
    }
}

// Tooltip rendering
function showTooltip(e) {
    let target = null;
    if (e.target && e.target.closest) {
        target = e.target.closest(".factshield-highlight");
    }
    const actualTarget = target || (e.target && e.target.dataset && e.target.dataset.fsClaim ? e.target : null);
    
    if (!actualTarget) return;

    activeHighlightSpan = actualTarget;

    const data = actualTarget.dataset.fsClaim;
    if (!data) return;

    try {
        const claim = JSON.parse(data);

                const isAIDomain = isKnownAIDomain();
                const reason = claim.reason || {};
                const tooltipTitle = getFriendlyTooltipTitle(claim);
                const tooltipIntro = getFriendlyTooltipIntro(claim);
                const triggerMarkup = buildTooltipReasonMarkup(reason, claim.sourceType);
                const isHeadline = claim.sentence && claim.sentence.length < 70;
                const headlineTip = isHeadline
                    ? `<div style="margin-top:6px; font-size:11px; color:#d9534f; font-weight: 500;">Tip: This looks like a headline. Selecting a full sentence often gives better results.</div>`
                    : "";

                // NEW: OpenRouter AI Deep Analysis
                const isManual = claim.sourceType === "manual";
                const aiBtnMarkup = (isManual && window.fsAiEnabled !== false) ? `<button type="button" id="fs-ai-btn" class="fs-ai-btn">🤖 AI Analysis</button>` : '';

                const factCheckActionsMarkup = `
                        <div class="fs-tooltip-actions">
                            <button type="button" id="fs-factcheck-btn" class="fs-tooltip-search-btn">Search fact-checking sites &rarr;</button>
                            <div class="fs-tooltip-search-note">Opens PolitiFact, Snopes, FactCheck.org & Reuters with your exact claim.</div>
                            ${headlineTip}
                            ${aiBtnMarkup}
                            <div class="fs-tooltip-search-status" hidden></div>
                            <div id="fs-ai-result-container" hidden></div>
                        </div>
                    `;
                let icon = claim.sourceType === "api" && claim.rating?.toLowerCase().includes("false") ? "⚠️" : "ℹ️";
                let headerClass = claim.rating?.includes("False") || claim.rating?.includes("Misleading") ? "strong" : "";

        tooltip.innerHTML = `
            <div class="fs-tooltip-header ${headerClass}">${icon} ${tooltipTitle}</div>
            <div class="fs-tooltip-body">${tooltipIntro}</div>
            ${triggerMarkup}
            <div class="fs-tooltip-sources">
                ${claim.publisher ? `From: ${claim.publisher}` : ""}
                ${claim.sourceUrl && claim.sourceUrl !== "#" ? `<br><a href="${claim.sourceUrl}" target="_blank" rel="noopener noreferrer">Read full source</a>` : ""}
            </div>
                    ${factCheckActionsMarkup}
            <button type="button" id="fs-ignore-btn" class="fs-tooltip-ignore-btn">Ignore this claim</button>
        `;

                const factCheckButton = tooltip.querySelector("#fs-factcheck-btn");
                if (factCheckButton) {
                    factCheckButton.addEventListener("click", handleFactCheckSearch);
                }

        const ignoreButton = tooltip.querySelector("#fs-ignore-btn");
        if (ignoreButton) {
            ignoreButton.addEventListener("click", handleIgnore);
        }

        // NEW: OpenRouter AI Deep Analysis
        const aiButton = tooltip.querySelector("#fs-ai-btn");
        if (aiButton) {
            aiButton.addEventListener("click", () => handleAIFactCheck(claim.sentence || actualTarget.textContent || ""));
        }

        // Add domain-specific note for Gemini (optional nice touch)
        // Add LLM-specific reminder when on a known AI chat interface
        if (isAIDomain) {
            let aiName = "this AI";

            if (/gemini\.google\.com/i.test(window.location.hostname)) aiName = "Gemini";
            else if (/claude\.ai/i.test(window.location.hostname)) aiName = "Claude";
            else if (/chat\.openai\.com|chatgpt\.com/i.test(window.location.hostname)) aiName = "ChatGPT";
            else if (/copilot\.microsoft\.com|bing\.com\/chat/i.test(window.location.hostname)) aiName = "Copilot";
            else if (/grok\.x\.ai/i.test(window.location.hostname)) aiName = "Grok";
            else if (/perplexity\.ai/i.test(window.location.hostname)) aiName = "Perplexity";
            else if (/you\.com/i.test(window.location.hostname)) aiName = "You.com";
            else if (/poe\.com/i.test(window.location.hostname)) aiName = "Poe";

            tooltip.innerHTML +=
                `<div style="margin-top:8px; font-size:11px; color:#666;">` +
                `(${aiName} can occasionally invent details or cite non-existent sources — good to double-check!)</div>`;
        }

        tooltip.style.display = "block";

        if (e.forceCenter || !actualTarget.getBoundingClientRect || (actualTarget.getBoundingClientRect().width === 0)) {
            const tooltipRect = tooltip.getBoundingClientRect();
            tooltip.style.top = `${window.scrollY + (window.innerHeight / 2) - (tooltipRect.height / 2)}px`;
            tooltip.style.left = `${window.scrollX + (window.innerWidth / 2) - (tooltipRect.width / 2)}px`;
        } else {
            const rect = actualTarget.getBoundingClientRect();
            let top = window.scrollY + rect.bottom + 10;
            let left = window.scrollX + rect.left;

            const tooltipRect = tooltip.getBoundingClientRect();
            if (left + tooltipRect.width > window.innerWidth - 20) {
                left = window.scrollX + rect.right - tooltipRect.width;
            }
            if (top + tooltipRect.height > window.innerHeight + window.scrollY) {
                top = window.scrollY + rect.top - tooltipRect.height - 10;
            }

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
        }
    } catch (err) {
        console.error("Tooltip error:", err);
    }
}

function hideTooltip() {
    clearTimeout(window.fsTooltipHide);
    window.fsTooltipHide = setTimeout(() => {
        activeHighlightSpan = null;
        if (tooltip) tooltip.style.display = "none";
    }, 500);
}

window.addEventListener("pagehide", clearBadge);
window.addEventListener("beforeunload", clearBadge);

// Keep tooltip alive if hovered
document.addEventListener("mouseover", (e) => {
    if (tooltip && (e.target === tooltip || tooltip.contains(e.target))) {
        clearTimeout(window.fsTooltipHide);
    }
});

// === NEW: MANUAL CHECKER SECTION ===
let floatingBtn = null;

function createManualFloatingButton() {
    if (floatingBtn) return;
    floatingBtn = document.createElement("button");
    floatingBtn.className = "fs-manual-floating-btn";
    floatingBtn.innerHTML = "🔍 Fact-check";
    floatingBtn.style.display = "none";
    document.body.appendChild(floatingBtn);

    floatingBtn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // Prevent losing selection
    });
    
    floatingBtn.addEventListener("click", () => {
        executeManualCheck();
        hideManualFloatingButton();
    });
}

function hideManualFloatingButton() {
    if (floatingBtn) floatingBtn.style.display = "none";
}

document.addEventListener("selectionchange", () => {
    if (!isActive || !manualEnabled) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
        hideManualFloatingButton();
        return;
    }

    const text = selection.toString().trim();
    if (text.length < 15) {
        hideManualFloatingButton();
        return;
    }

    // Show button
    createManualFloatingButton();
    clearTimeout(manualButtonTimeout);

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    floatingBtn.style.top = `${window.scrollY + rect.bottom + 8}px`;
    floatingBtn.style.left = `${window.scrollX + rect.left + (rect.width / 2) - 50}px`;
    floatingBtn.style.display = "flex";

    // Disappear after 8 seconds
    manualButtonTimeout = setTimeout(hideManualFloatingButton, 8000);
});

// Remove button if clicked elsewhere
document.addEventListener("mousedown", (e) => {
    if (floatingBtn && e.target !== floatingBtn) {
        hideManualFloatingButton();
    }
});

// Listener from background for shortcut or context menu
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "triggerManualCheck") {
        executeManualCheck(request.text);
    }
});

function executeManualCheck(providedText) {
    if (!isActive || !manualEnabled) return;
    
    let text = providedText;
    let range = null;

    if (!text) {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
            text = selection.toString().trim();
            range = selection.getRangeAt(0);
        }
    }

    if (!text) return; // Note: For a strictly exact fallback, we could try grabbing the sentence at cursor, but selection string is safest.

    const claimKey = normalizeClaimKey(text);
    const sentence = shortenClaimForFactCheckSearch(text);

    // Apply temporary manual highlight
    let manualSpan = null;
    if (range) {
        manualSpan = setManualTempHighlight(range, text, sentence);
    }

    sendRuntimeMessage({ action: "checkClaim", sentence, manual: true }, (response) => {
        let match = response?.match;
        
        if (!match) {
            // No API match, build a local stub message
            match = {
                rating: "Unverified Manual Claim",
                explanation: "No published fact-check found. Consider checking PolitiFact, Snopes, or Reuters.",
                publisher: "FactShield Search",
                sourceType: "manual",
                reason: {
                    summary: "No direct match could be found in Google's Fact Check database.",
                    ruleName: "Manual Check",
                    triggers: [{label: "Searched term", value: sentence}],
                    matchedTerms: []
                }
            };
        } else {
            // Enhance the API match to show it was manual
            match.sourceType = "manual";
            if (!match.reason) match.reason = {};
            match.reason.ruleName = "Manual Check";
        }

        if (manualSpan) {
            manualSpan.dataset.fsClaim = JSON.stringify(buildFlagPayload(sentence, match, "manual"));
            // Keep the manual highlight active for tooltip interactions
            activeHighlightSpan = manualSpan;
            showTooltip({ target: manualSpan });
        } else {
            // Right-clicked a link directly with no selection
            const fakeSpan = document.createElement("span");
            fakeSpan.dataset.fsClaim = JSON.stringify(buildFlagPayload(sentence, match, "manual"));
            activeHighlightSpan = fakeSpan;
            showTooltip({ target: fakeSpan, forceCenter: true });
        }
    });

    if (window.getSelection) {
        window.getSelection().removeAllRanges();
    }
}

function setManualTempHighlight(range, originalText, sentence) {
    const span = document.createElement("span");
    span.className = "factshield-manual-highlight";
    span.textContent = originalText;

    // We store dummy claim data first in case hovered while loading
    span.dataset.fsClaim = JSON.stringify(buildFlagPayload(sentence, {
        rating: "Checking...",
        explanation: "Searching FactCheckTools..."
    }, "manual"));
    
    span.addEventListener("mouseenter", showTooltip);
    span.addEventListener("mouseleave", hideTooltip);

    try {
        range.deleteContents();
        range.insertNode(span);
        
        // Remove after 8 seconds (or keep if tooltip is open, though prompt requested 8 seconds)
        setTimeout(() => {
            if (span.parentNode) unwrapHighlight(span);
        }, 8000);
        return span;
    } catch (e) {
        console.warn("Failed to apply manual highlight", e);
        return null;
    }
}
// === END MANUAL CHECKER SECTION ===

// NEW: OpenRouter AI Deep Analysis
function handleAIFactCheck(sentence) {
    const aiBtn = tooltip.querySelector("#fs-ai-btn");
    const container = tooltip.querySelector("#fs-ai-result-container");
    
    if (aiBtn) {
        aiBtn.disabled = true;
        aiBtn.textContent = "🤖 Analyzing...";
    }
    
    sendRuntimeMessage({ action: "aiFactCheck", sentence, model: "openrouter/free" }, (response) => {
        if (aiBtn) aiBtn.style.display = "none";
        
        if (!container) return;
        container.hidden = false;

        if (response?.error) {
            container.innerHTML = `<div class="fs-ai-result-panel" style="color:#d32f2f;">${response.error}</div>`;
            // Re-adjust tooltip constraints
            showTooltip({ target: activeHighlightSpan, forceCenter: true });
            return;
        }

        const res = response?.result;
        if (res) {
            const sourcesMarkup = res.sources && res.sources.length > 0 
                ? ` • Sources: ${res.sources.map(s => `<a href="${s}" target="_blank" rel="noopener noreferrer" style="color:#007aff; text-decoration:none;">[link]</a>`).join(' ')}`
                : '';
                
            container.innerHTML = `
                <div class="fs-ai-result-panel">
                    <div class="fs-ai-verdict-title">🤖 AI Verdict: ${res.confidence}% ${res.verdict}</div>
                    <div style="margin-bottom:4px;">Explanation: ${res.explanation || 'No explanation provided.'}</div>
                    ${sourcesMarkup}
                </div>
            `;
            // Adjust position in case the tooltip height expanded
            showTooltip({ target: activeHighlightSpan, forceCenter: true });
        } else {
            container.innerHTML = `<div class="fs-ai-result-panel" style="color:#d32f2f;">Failed to get AI analysis.</div>`;
        }
    });
}

// One-time init guard
if (!window.factShieldInjected) {
    window.factShieldInjected = true;
    init();
}