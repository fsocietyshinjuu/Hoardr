# Changelog
All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com), versioning: [SemVer](https://semver.org).

## [1.1.0] - 2026-11-18
### Added
- **Profile preview**: see the profile name and a thumbnail grid of the first 24 items before downloading, without saving anything.
- Press Enter in the URL box to preview.
### Changed
- Project renamed from MediaGrab to **Hoardr**.

## [1.0.0] - 2026-11-18
### Added
- Electron desktop app for Windows, macOS and Linux.
- Auto-routing between gallery-dl (profiles, images) and yt-dlp (video sites).
- Output folder picker, optional Netscape cookies file, rate limiting.
- Live log console with cancel support.
- GitHub Actions workflows for tagged releases and GitHub Pages landing page.
- Built-in block for paid, subscriber-only platforms (OnlyFans, Fantia).

## [1.2.0] - 2026-11-18
### Added
- **Use login from your browser**: pick Brave, Chrome, Firefox, Edge and more; Hoardr reads that browser's existing session, so no cookies file is needed.
- **Open in browser** button to view the profile URL in your default browser.
### Improved
- Preview errors now show the real message from the engine (for example "login required").

## [1.1.1] - 2026-11-18
### Fixed
- Release workflow: Windows installer and portable builds no longer share one filename.
- Release workflow: macOS now bundles a real gallery-dl build (upstream ships no macOS binary).
- Release workflow: single publish job after all builds, avoiding concurrent-release races.
- package.json: added author email and homepage required for `.deb` packaging.
