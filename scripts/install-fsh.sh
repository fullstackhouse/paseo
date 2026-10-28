#!/usr/bin/env bash
# Install or update Paseo FSH (desktop app + CLI) and the FSH plugins on macOS (Apple Silicon).
#
#   curl -fsSL https://raw.githubusercontent.com/fullstackhouse/paseo/fsh/scripts/install-fsh.sh | bash
#
# Options: --yes (don't ask before quitting Paseo), --no-plugins, --force (reinstall the same build).
set -euo pipefail

REPO="fullstackhouse/paseo"
PLUGINS=(paseo-asks paseo-status paseo-limits paseo-prs)
APP="/Applications/Paseo.app"
PASEO="$APP/Contents/Resources/bin/paseo"
MARKER="$HOME/.paseo/fsh-release"

yes=0 plugins=1 force=0
for arg in "$@"; do
  case "$arg" in
    --yes | -y) yes=1 ;;
    --no-plugins) plugins=0 ;;
    --force) force=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || die "macOS on Apple Silicon only."

# GitHub's "latest" release is always the newest desktop build; Android releases opt out of it.
dmg_url="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  grep -o '"browser_download_url": *"[^"]*\.dmg"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')"
[[ -n "$dmg_url" ]] || die "No DMG found in $REPO releases."
tag="$(basename "$(dirname "$dmg_url")")"

if [[ $force -eq 0 && -d "$APP" && -f "$MARKER" && "$(cat "$MARKER")" == "$tag" ]]; then
  say "Paseo $tag is already installed."
else
  say "Installing Paseo $tag"
  tmp="$(mktemp -d)"
  trap 'hdiutil detach -quiet "$tmp/mnt" 2>/dev/null || true; rm -rf "$tmp"' EXIT
  curl -fL --progress-bar -o "$tmp/paseo.dmg" "$dmg_url"

  # Every FSH build reports the same version, so neither the app nor the daemon notices a swap
  # underneath it. Quit both, or the old build keeps running.
  if pgrep -qf "$APP/Contents/MacOS/Paseo" || { [[ -x "$PASEO" ]] && "$PASEO" daemon status 2>/dev/null | grep -q 'localDaemon: running'; }; then
    if [[ $yes -eq 0 ]]; then
      printf 'Paseo is running. Quitting it stops the daemon and every running agent. Continue? [y/N] '
      read -r answer </dev/tty
      [[ "$answer" =~ ^[Yy] ]] || die "Aborted."
    fi
    say "Quitting Paseo"
    osascript -e 'quit app "Paseo"' 2>/dev/null || true
    for _ in {1..30}; do pgrep -qf "$APP/Contents/MacOS/Paseo" || break; sleep 1; done
    [[ -x "$PASEO" ]] && "$PASEO" daemon stop >/dev/null 2>&1 || true
  fi

  # The Homebrew casks would put their own build back on `brew upgrade`.
  if command -v brew >/dev/null; then
    for cask in paseo-fsh paseo; do
      if brew list --cask "$cask" >/dev/null 2>&1; then
        say "Removing Homebrew cask $cask"
        brew uninstall --cask "$cask"
      fi
    done
  fi

  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$tmp/mnt" "$tmp/paseo.dmg"
  rm -rf "$APP"
  ditto "$tmp/mnt/Paseo.app" "$APP"
  hdiutil detach -quiet "$tmp/mnt"
  # The build is unsigned; Gatekeeper refuses it while the quarantine flag is set.
  xattr -cr "$APP"
  mkdir -p "$(dirname "$MARKER")"
  echo "$tag" >"$MARKER"
fi

# CLI on PATH.
for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  if [[ -d "$dir" && -w "$dir" ]] || [[ "$dir" == "$HOME/.local/bin" ]]; then
    mkdir -p "$dir"
    ln -sf "$PASEO" "$dir/paseo"
    say "Linked paseo CLI into $dir"
    [[ ":$PATH:" == *":$dir:"* ]] || echo "    add $dir to your PATH"
    break
  fi
done

pgrep -qf "$APP/Contents/MacOS/Paseo" || open "$APP"

[[ $plugins -eq 1 ]] || exit 0

say "Waiting for the daemon"
for _ in {1..60}; do
  "$PASEO" daemon status 2>/dev/null | grep -q 'localDaemon: running' && break
  sleep 1
done
"$PASEO" daemon status 2>/dev/null | grep -q 'localDaemon: running' || die "Daemon didn't start; rerun this script once Paseo is up."

"$PASEO" daemon config set pluginsEnabled true >/dev/null
"$PASEO" daemon reload >/dev/null

installed="$("$PASEO" plugin ls -q 2>/dev/null || true)"
for plugin in "${PLUGINS[@]}"; do
  if grep -qx "$plugin" <<<"$installed"; then
    say "Updating $plugin"
    "$PASEO" plugin update "$plugin" --yes
  else
    say "Installing $plugin"
    "$PASEO" plugin install "git:fullstackhouse/$plugin" >/dev/null
  fi
done

say "Done. Agents started before a plugin was installed don't get its tools; start a new agent."
