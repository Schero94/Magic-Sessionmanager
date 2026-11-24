# Risk data gates (VPN, proxy, Tor, hosting)

Branch `fix/honest-risk-data`. The bug: suspicious sign-in detection could never trigger, because ipapi.co sends no `threat` object and local GeoLite2 results always scored 100. These gates describe the fix (honest UI without a source) and the feature (local MaxMind Anonymous IP database, plus the GeoLite2 ASN heuristic).

- [x] R1: Without a risk data source, nothing is presented as checked, and nothing is refused or alerted as suspicious.
      EVIDENCE: `tests/risk-honesty.test.js`, `tests/geo-firewall.test.js`, `tests/admin/risk-honesty.test.jsx` and `tests/risk-availability.test.mjs` pass in `npm test` (890/890) and `npm run test:admin` (20/20, including the row-action tests from #32) after the rebase onto `1b27ad2` (4.14.3).
- [x] R2: With a risk source, the expected rule fires for each case. VPN, Tor and proxy addresses are refused, a hosting network only alerts, and a clean address passes. The VPN email, the suspicious-sign-in email and the `login.suspicious` webhook all fire.
      EVIDENCE: `tests/risk-databases.test.js` (13/13) reads synthetic MMDB fixtures with the real `@maxmind/geoip2-node` 7.1 reader. The emails go through the real notification service to a fake Email plugin, and the webhook goes through the real sender with `fetch` stubbed.
- [x] R3: Real host, real sign-ins.
      EVIDENCE: 2026-11-24, 21:03 to 21:30 CET. - Setup: plugin `9d758b7` (the feature commit before the rebase onto 4.14.3; its risk code is unchanged by the rebase), packed as `strapi-plugin-magic-sessionmanager-4.14.2.tgz`. Strapi and Users & Permissions 5.63.0, Node 22.23.1, DS 2.3.1. Host `127.0.0.1:1441`, SQLite, random `.env`, egress preload active (the browser's only blocked attempt was `api.github.com`). One React 18.3.1 and one styled-components 6.6.0. - Fixtures: synthetic MMDB files in `data/magic-sessionmanager/geoip/`, Trust proxy headers on. - `POST /api/auth/local` with `X-Forwarded-For: 25.0.1.10` (VPN record) answered **403** "Login blocked for security reasons", and the log shows `vpn_detected`. - The same call with `25.0.2.10` (no anonymiser record) answered **200**. The session stored `securityScore: 100` and `geoLocation.riskSource: 'anonymous-ip'`. - `GET /magic-sessionmanager/geoip/status` returned `risk.available: true`, `source: 'anonymous-ip'`.
- [x] R4: Browser acceptance, headless Playwright, on the same host and build.
      EVIDENCE: Screens covered: - Login protection, Location data and Alerts, without and with a risk source. - Session details for a pre-fix row (score 100, no source) and for a row with a source.

      Matrix: 1440, 1280, 1080, 1024, 768, 520, 390 and 320 px, light and dark, in English. German, French, Spanish and Portuguese ran at 1440 and 320, with German also without a source.

      `measure.js` results:
      - `documentOverflow` 0, `rowHeightMismatch` [], `offScaleGaps` [], `clippedText` [] and `lowContrast` [] at every stop.
      - No ICU or message-id leaks.
      - `smallTargets` lists only pre-existing controls: NumberInput steppers, DS checkboxes, inline links inside notices (WCAG 2.5.8 inline exception) and the 24 px "Requires…" tab links below 768 px (existing `SettingsTabLink`).
      - `elementsOutsideViewport` lists only the horizontally scrolling tab list.

      Console: 0 plugin messages. Core noise: `useRBAC` object warning and the React Router future-flag warning. Egress: the blocked `api.github.com` request.

      Facts checked in the rendered pages:
      - Without a source, the reject and scoring switches render `aria-checked=false` and disabled, "Saved as on" is shown, and "No risk data source" is shown.
      - With a source, both switches are on and enabled.
      - The pre-fix session shows "Not available" and no score; the session with a source shows "70/100".
      - Keyboard: the Tab key reaches "Set up risk data", with no focus on `BODY`, and Enter opens Location data.

      Screenshots are under the scratchpad `sessionmanager-risk/` folder and were opened and checked. They contain only synthetic data and are not committed.

- [ ] R5: Live MaxMind download of GeoIP2 Anonymous IP and GeoLite2 ASN.
      OPEN: no MaxMind account was used, and egress is blocked by design. The download path is covered with a fake updater (edition, fixed file, credentials, 401/403 mapping) and the edition IDs follow MaxMind's docs. A first real download should be checked by the owner.
- [ ] R6: The keyboard focus ring on the inline "Set up risk data" link was not measured: the DS Link draws focus without `outline` or `box-shadow` on the element itself. Check it visually on the next pass.

Teardown: the host was stopped, and `.env`, `creds.json`, the SQLite database and the fixture databases were deleted.
