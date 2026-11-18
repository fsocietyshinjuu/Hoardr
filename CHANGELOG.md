# Changelog
All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com), versioning: [SemVer](https://semver.org).

## [1.1.0] - 2026-11-18
### Added
- **New app icon** (app window, installers and landing page).
- **Live progress**: progress bar, new-file counter and current filename while syncing; the gallery refreshes as files arrive and the sidebar shows "Syncing… N new".
- **Streaming preview**: thumbnails appear one by one as they are found; Stop button; 2-minute idle timeout instead of a hard 60 s limit.
- **Login status**: a ✓ per signed-in site in the login dialog and a summary in the sidebar.
### Fixed
- Login popup now detects a successful login, saves the session, and closes itself.
- Logins persist after the popup is closed and across app restarts (session cookies get an expiry and are flushed to disk).
- Preview failures now show the engine's real error message.
### Changed
- Landing page redesigned with features, download buttons that link to the latest release, and this changelog.

## [1.0.0] - 2026-11-18
### Added
- Desktop app for Windows, macOS and Linux (Electron), powered by gallery-dl and yt-dlp, with both engines bundled.
- **In-app login** for Instagram, X, Facebook, Threads, TikTok, Reddit, Pinterest, YouTube or any site. Sign in inside Hoardr; no cookies file needed.
- **Subscriptions**: add profiles once; only new posts are downloaded on each check.
- **Auto-check** on a schedule (30 minutes to daily).
- **Profile preview**: thumbnail grid of the first 24 items before subscribing.
- **Built-in gallery** per profile with one-click open.
- **Auto-update** via GitHub Releases (Windows Setup installer and Linux AppImage; other builds show a download notice).
- Block on paid, subscriber-only platforms (OnlyFans, Fantia).
- GitHub Actions workflows for tagged releases and the GitHub Pages landing page.
