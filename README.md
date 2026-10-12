# Horizons for Todoist - Website & Legal Documentation

This repository hosts the official documentation, Privacy Policy, and Terms of Use for the **Horizons for Todoist** browser extension.

## Live Website

- **Website / Overview:** [https://todoisthorizons.github.io/](https://todoisthorizons.github.io/)
- **Privacy Policy:** [https://todoisthorizons.github.io/privacy.html](https://todoisthorizons.github.io/privacy.html)
- **Terms of Use:** [https://todoisthorizons.github.io/terms.html](https://todoisthorizons.github.io/terms.html)

## Website analytics

All four pages load `analytics.js`, using the extension's existing EU PostHog
project. Autocapture and session replay are enabled. Every event carries
`app_surface: "website"` and `analytics_environment: "production"`; extension
events carry `app_surface: "extension"`. Historical events are unchanged.

The public project ingestion token is intentionally visible in this static site.
Unlike a personal API key, it is not an administrative credential. GitHub Pages
has no build step or runtime environment-variable substitution here; never put
a CLI/personal token in this repository.

Form values are excluded from autocapture and masked in replay. Console logs and
network bodies/headers are not recorded. Navigation query strings and fragments
are stripped; campaign attribution is retained separately. Custom events are:

- `website_install_button_clicked`: includes CTA placement and
  `install_listing_available`. The current store links are placeholders, so this
  is **not** an installation event.
- `website_contact_message_sent`: confirmed Web3Forms success only.
- `website_uninstall_feedback_sent`: confirmed Web3Forms success only.

Normal local previews do not load PostHog. For a deliberate localhost browser
test, set `window.HORIZONS_ANALYTICS_TEST = true` before this script runs (for
example, with Playwright's `addInitScript`). Those events carry
`analytics_environment: "test"`; exclude them from production analyses.
No shared PostHog project settings are changed by this integration.

Cookie-banner/consent work is deferred, not considered resolved. Before public
deployment, review consent requirements and actual project retention settings.

Run the focused regression checks with `node --test tests/analytics.test.js`.

## Disclaimer

Horizons for Todoist is an independent project and is not affiliated with, endorsed by, or sponsored by Todoist Inc. or Todoist.