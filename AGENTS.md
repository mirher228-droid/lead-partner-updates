# Common extension maintenance

This public repository maintains the OLD common Avito/LeadChat extension. Editable sources are in `extension/`, imported from Common 1.2.50. Do not merge Admin, employee pilot or TG Chaters functionality unless explicitly requested.

Run `python tools/build_common.py` (Python 3 and Node.js required). It checks JavaScript syntax and manifest resources, then creates a deterministic ZIP with regenerated SHA-256 inventory in `dist/`. Run `python -m unittest discover -s tests -p 'test_cloud_build.py'` for packaging regression checks.

Run `node --test` for panel reliability regressions. Browser recovery tests need Node.js 22+ and Chromium/Chrome (`CHROMIUM_PATH` overrides `/usr/bin/chromium`). They serve synthetic data locally and must not contact real CRM. CI uses the Windows runner's installed Chrome. Packaging checks also verify HTML dependencies and literal top-level worker imports.

Read `docs/development-progress.md` before continuing reliability or base-selection work. It records completed changes, validation boundaries and the current phase. Keep measured results tied to their exact source snapshot; an earlier long run does not validate later edits.

Windows updater/release tests run in GitHub Actions. Do not claim Linux syntax checks prove live CRM integration. Add focused offline tests for any behavior changed. Do not edit real CRM requests or send Telegram messages without specific user instructions.

Do not change manifest key or extension identity. Do not commit browser data, employee records, credentials, owner-bootstrap files or local absolute paths. Existing `releases/` archives are immutable baselines.

Builds and commits alone must not release an update to employees. Only after an explicit instruction to release: bump manifest version, build and validate ZIP with tools/Release.Common.ps1 on Windows, create the corresponding common-vVERSION stable release with the exact ZIP, then verify the existing release-common workflow and update.json. Never overwrite a previous version's archive. Preserve pilot releases as prereleases and keep their channel separate.

Report what changed, tests run, artifact and whether employees have actually received a release. Never promise immediate installation: the existing updater applies the extension after the browser fully exits.
