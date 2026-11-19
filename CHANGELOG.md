# Changelog
All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com), versioning: [SemVer](https://semver.org).

## [1.3.1] - 2026-11-19
### Changed
- **X (Twitter) sign-in**: clicking X now recommends the browser-session method first, because X rate-limits and blocks sign-in inside apps ("We've temporarily limited your login"). The cookie panel has step-by-step instructions for finding `auth_token` and `ct0`.

## [1.3.0] - 2026-11-19
### Added
- **Download type** per profile: photos & videos, photos only, or videos only. Chosen when adding, changeable from the profile header.
- **Gallery views**: thumbnail grid or list (type, size, date, show-in-folder), All / Photos / Videos filter, remembered between sessions.
- **Close button** to close the open profile's gallery.
- **Auto-start**: adding a profile downloads it immediately.
- Per-profile **Stop** button and a visible **Queued** state.
- App preview illustrations on the landing page and in the README.
### Fixed
- Only the first profile could be checked; others and newly added profiles never started. Syncs now run in parallel (up to 4 at once, 2 per site) instead of one slow job blocking the rest, and a failed job can no longer jam the queue.

## [1.2.0] - 2026-11-19
### Added
- **Add by username**: site dropdown plus username-only or full-link input; pasting a link selects the site automatically.
- **Profile cards**: profile picture, name and bio shown in the preview and the sidebar (best effort, from the page's public preview tags).
- **Tray mode**: the app opens maximized; closing the window hides it to the system tray with a notification, and a tray menu offers Open, Check all and Quit. Only one instance runs at a time.
- **Cookie fallback** for sites that block in-app sign-in: paste X `auth_token`/`ct0`, or import a cookies.txt file.
- Re-login option when already signed in to a site.
- Video thumbnails in preview and gallery.
### Fixed
- Login window now closes reliably right after sign-in (checks every second and on navigation).
- Preview reports warnings instead of silently showing a nearly empty grid.
- Broken Windows icon on the landing page.

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
