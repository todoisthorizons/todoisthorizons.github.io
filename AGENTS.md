# Instructions for AI Agents & Contributors

## 1. Core Principles (KISS & Quality)
- **Production quality without over-engineering**: Write clean, maintainable, and reliable code for real users. Avoid speculative abstractions and unnecessary complexity.
- **No band-aids or quick fixes**: Always solve problems at their root cause.
- **Fast iteration & deliberate testing**: Work quickly and iteratively in small, focused increments. Do NOT run the full regression test suite (`node --test tests/*.test.js`) on every minor CSS or copy tweak. Run targeted checks relevant to touched files (e.g. `node --test tests/analytics.test.js` or syntax validation `node -c <file.js>`). Reserve full test runs for major milestones or when explicitly requested.
- **Explicit consent required**: Never commit or push changes unless the user explicitly instructs you to do so.
- **No unauthorized Computer Use**: NEVER initiate or execute GUI-level/visual Computer Use (taking screenshots to drive mouse coordinates and keystrokes) without explicit user permission and a clear upfront warning detailing the excessive token consumption, latency, and costs. Always prioritize programmatic alternatives (APIs, DOM/CDP inspection, DevTools MCP, or headless scripts) first.

## 2. Project Architecture & Quick Commands
- **Stack**: Static Website (HTML5, Vanilla JS, CSS3), PostHog Analytics, GitHub Pages.
- **Key Files**: `index.html`, `style.css`, `privacy.html`, `terms.html`, `analytics.js`, `contact.js`.
- **Quick Commands**:
  - Syntax Check: `node -c <file.js>`
  - Targeted Test: `node --test tests/analytics.test.js`
  - Full Test Suite: `node --test tests/*.test.js` (milestones / releases)

## 3. Git & Release Protocol
1. **Never Commit Secrets**: The public PostHog ingestion token is public in client code, but never commit personal or administrative API keys.
2. **Explicit Consent Required**: Never commit or push changes without explicit user approval.

## 4. Domain & Platform Rules
- **Native Todoist Aesthetic**: Strictly mirror Todoist's official design language, typography, and palette.
- **Analytics Isolation**: Form values and sensitive text must be excluded from autocapture and masked in replay.
