## Hoardr 1.3.0

### What's new
- 🎛️ **Photos, videos or both**: pick what to download for each profile when you add it, and change it any time from the profile header.
- 🗂️ **Gallery views**: thumbnails or a detailed list (type, size, date, show in folder), with an All / Photos / Videos filter. A **✕ Close** button closes the open profile.
- ⚡ **Auto-start**: a profile starts downloading the moment you add it. No need to press Check.
- ⏹️ Per-profile **Stop** button and a clear **Queued** state.

### Fixed
- **Only the first profile could be checked.** Other and newly added profiles waited behind one slow job and never started. Syncs now run in parallel (up to 4 at once, 2 per site), and a failed job can no longer block the queue.

### Updating
Installed from the **Setup** `.exe` or the **AppImage**? Hoardr offers this update by itself. Other builds: download below.

### Downloads
| Platform | File |
|---|---|
| Windows | `Hoardr-Setup` installer (auto-updates) or `Hoardr-Portable` |
| macOS | `.dmg` (unsigned: right-click → Open on first launch) |
| Linux | `.AppImage` (auto-updates) / `.deb` |

See [CHANGELOG.md](CHANGELOG.md) for details.
