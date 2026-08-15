// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const toggleSwitch = document.getElementById('toggle-extension');
    const statusLabel = document.getElementById('status-label');
    const recentFlagsContainer = document.getElementById('recent-flags');
    const toggleManual = document.getElementById('toggle-manual'); // NEW: Manual Claim Checker
    const toggleAi = document.getElementById('toggle-ai'); // NEW: OpenRouter AI Deep Analysis
    const openrouterApiKey = document.getElementById('openrouter-api-key');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const keySaveStatus = document.getElementById('key-save-status');
    const googleApiKey = document.getElementById('google-api-key');
    const saveGoogleKeyBtn = document.getElementById('save-google-key-btn');
    const googleKeySaveStatus = document.getElementById('google-key-save-status');
    const domainInput = document.getElementById('blocked-domain');
    const addDomainBtn = document.getElementById('add-domain-btn');
    const domainList = document.getElementById('domain-list');

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeFlag(flag) {
        const reason = flag.reason || {};
        const legacySummary = 'This flag was stored before detailed reason tracking was added.';
        const sentence = flag.sentence || flag.claim || 'Unknown sentence';
        const summary = reason.summary || flag.explanation || legacySummary;
        const triggers = Array.isArray(reason.triggers) ? reason.triggers : [];
        const matchedTerms = Array.isArray(reason.matchedTerms) ? reason.matchedTerms : [];
        const hasDetailedReason = Boolean(reason.summary) || triggers.length > 0 || matchedTerms.length > 0;

        return {
            sentence,
            rating: flag.rating || 'Potential Factual Claim',
            sourceType: flag.sourceType || 'generic',
            publisher: flag.publisher || 'FactShield',
            sourceUrl: flag.sourceUrl || '#',
            pageUrl: flag.pageUrl || flag.url || 'Unknown',
            timestamp: flag.timestamp,
            reason: {
                summary,
                ruleName: reason.ruleName || (hasDetailedReason ? flag.rating || 'FactShield rule' : 'Legacy stored flag'),
                score: typeof reason.score === 'number' ? reason.score : null,
                matchedTerms,
                triggers
            }
        };
    }

    function formatScore(score) {
        return typeof score === 'number' ? score.toFixed(1) : null;
    }

    function buildTriggerMarkup(flag) {
        if (flag.reason.triggers.length === 0 && flag.reason.matchedTerms.length === 0) {
            return '';
        }

        const triggerItems = flag.reason.triggers.map((trigger) => {
            const parts = [
                trigger.value ? `<span class="flag-trigger-value">${escapeHtml(trigger.value)}</span>` : '',
                trigger.pattern ? `<span class="flag-trigger-pattern">Pattern: ${escapeHtml(trigger.pattern)}</span>` : '',
                typeof trigger.weight === 'number' ? `<span class="flag-trigger-weight">+${escapeHtml(trigger.weight)}</span>` : ''
            ].filter(Boolean).join(' ');

            return `<div class="flag-trigger-item"><span class="flag-trigger-label">${escapeHtml(trigger.label || 'Trigger')}</span>${parts ? `<div class="flag-trigger-detail">${parts}</div>` : ''}</div>`;
        }).join('');

        const matchedTerms = flag.reason.matchedTerms.length > 0
            ? `<div class="flag-matched-terms">Matched terms: ${flag.reason.matchedTerms.map((term) => `<span class="flag-chip">${escapeHtml(term)}</span>`).join('')}</div>`
            : '';

        return `<div class="flag-triggers">${triggerItems}${matchedTerms}</div>`;
    }

    // Load initial state
    chrome.storage.local.get(['isActive', 'recentFlags', 'blockedDomains', 'manualEnabled', 'aiEnabled', 'openrouterApiKey', 'googleApiKey'], (result) => {
        // Set toggle state
        const isActive = result.isActive !== false;
        toggleSwitch.checked = isActive;
        updateStatusLabel(isActive);
        
        // NEW: Manual Claim Checker
        if (toggleManual) {
            toggleManual.checked = result.manualEnabled !== false;
        }

        // NEW: OpenRouter AI Deep Analysis
        if (toggleAi) {
            toggleAi.checked = result.aiEnabled !== false;
        }
        if (openrouterApiKey && result.openrouterApiKey) {
            openrouterApiKey.value = result.openrouterApiKey;
        }
        if (googleApiKey && result.googleApiKey) {
            googleApiKey.value = result.googleApiKey;
        }

        // Render flags
        renderFlags(result.recentFlags || []);

        // Render domains
        renderDomains(result.blockedDomains || []);
    });

    // Toggle extension state
    toggleSwitch.addEventListener('change', (e) => {
        const isActive = e.target.checked;
        chrome.storage.local.set({ isActive: isActive });
        updateStatusLabel(isActive);
    });

    // NEW: Manual Claim Checker
    if (toggleManual) {
        toggleManual.addEventListener('change', (e) => {
            chrome.storage.local.set({ manualEnabled: e.target.checked });
        });
    }

    // NEW: OpenRouter AI Deep Analysis
    if (toggleAi) {
        toggleAi.addEventListener('change', (e) => {
            chrome.storage.local.set({ aiEnabled: e.target.checked });
        });
    }

    if (saveKeyBtn && openrouterApiKey) {
        saveKeyBtn.addEventListener('click', () => {
            const key = openrouterApiKey.value.trim();
            chrome.storage.local.set({ openrouterApiKey: key }, () => {
                keySaveStatus.hidden = false;
                setTimeout(() => keySaveStatus.hidden = true, 2000);
            });
        });
    }

    if (saveGoogleKeyBtn && googleApiKey) {
        saveGoogleKeyBtn.addEventListener('click', () => {
            const key = googleApiKey.value.trim();
            chrome.storage.local.set({ googleApiKey: key }, () => {
                googleKeySaveStatus.hidden = false;
                setTimeout(() => googleKeySaveStatus.hidden = true, 2000);
            });
        });
    }

    function updateStatusLabel(isActive) {
        if (isActive) {
            statusLabel.textContent = 'Active';
            statusLabel.className = 'status-text';
        } else {
            statusLabel.textContent = 'Paused';
            statusLabel.className = 'status-text inactive';
        }
    }

    function renderFlags(flags) {
        if (flags.length === 0) {
            recentFlagsContainer.innerHTML = '<div class="empty-state">No recent flags. Keep browsing safely!</div>';
            return;
        }

        recentFlagsContainer.innerHTML = '';
        flags.forEach((rawFlag) => {
            const flag = normalizeFlag(rawFlag);
            const item = document.createElement('div');
            item.className = 'flag-item';

            let domain = 'Unknown';
            try { domain = new URL(flag.pageUrl).hostname; } catch (e) { }

            const time = new Date(flag.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const score = formatScore(flag.reason.score);
            const triggerMarkup = buildTriggerMarkup(flag);
            const sourceLink = flag.sourceUrl && flag.sourceUrl !== '#'
                ? `<a class="flag-source-link" href="${escapeHtml(flag.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a>`
                : '';

            item.innerHTML = `
                <div class="flag-topline">
                    <span class="flag-domain">${escapeHtml(domain)}</span>
                    <span class="flag-time">${escapeHtml(time)}</span>
                </div>
                <div class="flag-sentence">${escapeHtml(flag.sentence)}</div>
                <div class="flag-summary">${escapeHtml(flag.reason.summary)}</div>
                <div class="flag-badges">
                    <span class="flag-badge">${escapeHtml(flag.reason.ruleName)}</span>
                    ${score ? `<span class="flag-badge flag-score">Score ${escapeHtml(score)}</span>` : ''}
                    <span class="flag-badge">${escapeHtml(flag.sourceType)}</span>
                </div>
                ${triggerMarkup}
                <div class="flag-footer">
                    <span class="flag-publisher">${escapeHtml(flag.publisher)}</span>
                    ${sourceLink}
                </div>
      `;
            recentFlagsContainer.appendChild(item);
        });
    }

    function renderDomains(domains) {
        domainList.innerHTML = '';
        domains.forEach((domain, idx) => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${domain}</span> <span class="remove-domain" data-idx="${idx}">✕</span>`;
            domainList.appendChild(li);
        });

        document.querySelectorAll('.remove-domain').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.getAttribute('data-idx'));
                chrome.storage.local.get(['blockedDomains'], (res) => {
                    let domains = res.blockedDomains || [];
                    domains.splice(idx, 1);
                    chrome.storage.local.set({ blockedDomains: domains });
                    renderDomains(domains);
                });
            });
        });
    }

    addDomainBtn.addEventListener('click', () => {
        const domain = domainInput.value.trim().toLowerCase();
        if (!domain) return;

        // Basic domain validation
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
            alert("Please enter a valid domain (e.g., example.com)");
            return;
        }

        chrome.storage.local.get(['blockedDomains'], (res) => {
            let domains = res.blockedDomains || [];
            if (domains.length >= 10) {
                alert("Maximum 10 custom domains allowed in Free version.");
                return;
            }
            if (!domains.includes(domain)) {
                domains.push(domain);
                chrome.storage.local.set({ blockedDomains: domains });
                renderDomains(domains);
                domainInput.value = '';
            }
        });
    });
});
