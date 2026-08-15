# Fact-Shield

Fact-Shield is a browser extension I'm tinkering with to make it a little easier to notice claims that might be worth double-checking while I browse.

It looks for things like numbers, dates, reporting-style language, strong certainty wording, and a small local set of known misinformation patterns. When something stands out, Fact-Shield can highlight it and explain **why** it caught its attention.

The goal is not to have an extension decide what is true for me. I want it to act more like a little media-literacy nudge: *this sentence is making a checkable claim — maybe take a closer look.*

## Very much a work in progress

This is an experimental hobby project more than a polished product right now. I'm having fun building it, breaking it, testing it, and seeing what works.

I'm also **not satisfied with how it behaves yet**. It can still miss things, flag things that don't really need attention, or behave awkwardly on some pages. I'm actively working through those rough edges and using the project as a place to experiment with browser extensions, claim detection, source checking, and human-in-the-loop fact checking.

So: use it as a helper, not an authority.

## What it currently does

- Automatically scans page text for potentially checkable factual claims.
- Highlights claims and explains what signals caused the flag.
- Checks a small built-in cache of common misinformation patterns.
- Can link directly to a source when a local rule has one.
- Can optionally query the Google Fact Check Tools API.
- Lets you select text and run a manual fact-check search.
- Can open searches across sites such as PolitiFact, Snopes, FactCheck.org, and Reuters when there isn't a direct source.
- Includes optional OpenRouter-powered AI analysis for manually checked claims.
- Keeps a short Recent Flags list in the extension popup.
- Lets you ignore individual claims you don't want flagged again.
- Lets you pause Fact-Shield or disable automatic checking on specific domains.
- Watches dynamically added page content, including content that appears after the initial page load.

## What a highlight means

A Fact-Shield highlight does **not** automatically mean a statement is false.

For ordinary claims, the extension is mostly noticing patterns that often appear in factual statements — numbers, dates, attribution language, named entities, and similar signals. The point is to surface something that may be worth verifying, not to hand down a verdict.

Known local-cache matches and published fact-check matches can provide stronger context, but I still want the human using the extension to look at the evidence and make the final judgment.

## Privacy

Fact-Shield is designed to be **local-first**, but it is not completely offline.

The basic heuristic scanner, local misinformation-pattern checks, ignored-claim list, and extension state run in the browser.

External requests only come into play when you use features that depend on them:

- If you configure a **Google Fact Check API key**, qualifying claims may be sent to Google's Fact Check Tools API for matching.
- If you configure an **OpenRouter API key** and use AI Analysis, the selected claim is sent to OpenRouter.
- Clicking source or search buttons opens external fact-checking/source websites in normal browser tabs.

API keys are entered through the extension popup and stored with Chrome's local extension storage. They are not committed to this repository.

## Installing it locally

There isn't a polished store release yet. For now, this is meant to be loaded as an unpacked Chromium extension.

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome or another Chromium-based browser.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select the Fact-Shield repository folder containing `manifest.json`.

After pulling new code, reload the extension from `chrome://extensions` before testing it again.

## Optional API keys

Fact-Shield can run without either API key, but some features will be limited.

### Google Fact Check Tools API

Add your own Google API key through the Fact-Shield popup if you want automatic claims to be checked against Google's Fact Check Tools API. The key should be restricted to the Fact Check Tools API where possible.

### OpenRouter

Add your own OpenRouter key through the popup if you want to experiment with the manual **AI Analysis** feature.

Neither key should be hardcoded into the extension source.

## Where I'm headed with it

Right now I'm mostly focused on making the core behavior less noisy, more understandable, and more predictable before I worry about piling on features.

If I can get Fact-Shield to consistently answer three questions well, I'll be happy with the direction:

1. **What claim did it notice?**
2. **Why did it think the claim was worth checking?**
3. **Where can I go to investigate it myself?**

That's the experiment.