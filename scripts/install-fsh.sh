#!/usr/bin/env bash
# Install or update Paseo FSH (desktop app + CLI) and the FSH plugins on macOS (Apple Silicon)
# or an RPM-based Linux (Fedora, x86_64).
#
#   curl -fsSL https://raw.githubusercontent.com/fullstackhouse/paseo/fsh/scripts/install-fsh.sh | bash
#
# Options: --yes (don't ask before quitting Paseo), --no-plugins, --force (reinstall the same build).
set -euo pipefail

REPO="fullstackhouse/paseo"
PLUGINS=(paseo-asks paseo-status paseo-limits paseo-prs paseo-inbox)
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

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64)
    OS=mac
    ASSET=dmg
    APP="/Applications/Paseo.app"
    PASEO="$APP/Contents/Resources/bin/paseo"
    ;;
  Linux/x86_64)
    command -v rpm >/dev/null && command -v dnf >/dev/null ||
      die "Linux builds are RPMs; this needs dnf (Fedora, RHEL and derivatives)."
    OS=linux
    ASSET=rpm
    APP="/opt/Paseo"
    PASEO="$APP/resources/bin/paseo"
    ;;
  *) die "macOS on Apple Silicon or x86_64 Linux with dnf only." ;;
esac

# Every process running the Electron binary, minus the daemon and CLI: those run the same binary as
# Node (ELECTRON_RUN_AS_NODE) through node-entrypoint-runner. /opt/Paseo/Paseo is a shell launcher
# (packages/desktop/scripts/linux-sandbox/launcher.sh) that execs /opt/Paseo/Paseo.bin, so exe links
# point at Paseo.bin. An upgraded RPM leaves them as "Paseo.bin (deleted)", hence the prefix match.
linux_app_pids() {
  local exe pid
  for exe in /proc/[0-9]*/exe; do
    [[ "$(readlink "$exe" 2>/dev/null)" == "$APP/Paseo.bin"* ]] || continue
    pid="${exe#/proc/}" pid="${pid%/exe}"
    tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q node-entrypoint-runner && continue
    echo "$pid"
  done
}

app_running() {
  if [[ $OS == mac ]]; then
    pgrep -f "$APP/Contents/MacOS/Paseo" >/dev/null
  else
    [[ -n "$(linux_app_pids)" ]]
  fi
}

quit_app() {
  if [[ $OS == mac ]]; then
    osascript -e 'quit app "Paseo"' 2>/dev/null || true
  else
    linux_app_pids | xargs -r kill -TERM 2>/dev/null || true
  fi
  for _ in {1..30}; do app_running || break; sleep 1; done
}

open_app() {
  if [[ $OS == mac ]]; then
    open "$APP"
  else
    setsid -f "$APP/Paseo" >/dev/null 2>&1 </dev/null
  fi
}

# How dnf gets root: sudo when someone can type the password, pkexec (a desktop password dialog)
# when the in-app updater runs this script detached from any terminal. Picked before Paseo quits,
# so a machine with neither stops here with the app still running.
pick_root() {
  if [[ $EUID -eq 0 ]]; then
    ROOT=()
  elif sudo -n true 2>/dev/null || { : </dev/tty; } 2>/dev/null; then
    ROOT=(sudo)
  elif command -v pkexec >/dev/null; then
    ROOT=(pkexec)
  else
    die "Installing the RPM needs root: rerun this script in a terminal."
  fi
}

installed() {
  if [[ $OS == mac ]]; then
    [[ -d "$APP" ]]
  else
    rpm -q Paseo >/dev/null 2>&1
  fi
}

# GitHub's "latest" release is always the newest desktop build; Android releases opt out of it.
asset_url="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  grep -o "\"browser_download_url\": *\"[^\"]*\\.$ASSET\"" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')"
[[ -n "$asset_url" ]] || die "No .$ASSET found in the latest $REPO release."
tag="$(basename "$(dirname "$asset_url")")"

if [[ $force -eq 0 ]] && installed && [[ -f "$MARKER" && "$(cat "$MARKER")" == "$tag" ]]; then
  say "Paseo $tag is already installed."
else
  say "Installing Paseo $tag"
  tmp="$(mktemp -d)"
  if [[ $OS == mac ]]; then
    trap 'hdiutil detach -quiet "$tmp/mnt" 2>/dev/null || true; rm -rf "$tmp"' EXIT
  else
    trap 'rm -rf "$tmp"' EXIT
  fi
  curl -fL --progress-bar -o "$tmp/paseo.$ASSET" "$asset_url"
  [[ $OS == mac ]] || pick_root

  # Every FSH build reports the same version, so neither the app nor the daemon notices a swap
  # underneath it. Quit both, or the old build keeps running.
  if app_running || { [[ -x "$PASEO" ]] && "$PASEO" daemon status 2>/dev/null | grep -q 'localDaemon: running'; }; then
    if [[ $yes -eq 0 ]]; then
      printf 'Paseo is running. Quitting it stops the daemon and every running agent. Continue? [y/N] '
      read -r answer </dev/tty
      [[ "$answer" =~ ^[Yy] ]] || die "Aborted."
    fi
    say "Quitting Paseo"
    quit_app
    [[ -x "$PASEO" ]] && "$PASEO" daemon stop >/dev/null 2>&1 || true
  fi

  if [[ $OS == mac ]]; then
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
  else
    # The RPM's release field carries the CI run number, so a newer build is an upgrade. The same
    # build (--force) needs reinstall, and an installed build newer than the latest release (a
    # `deploy` prerelease from a later run) needs downgrade: install does nothing for the first, and
    # on dnf4 for the second, and exits 0 either way.
    say "Installing the RPM (asks for your password)"
    new_vr="$(rpm -qp --qf '%{VERSION}-%{RELEASE}' "$tmp/paseo.rpm")"
    # Not `rpm -q --qf … || true`: with the package missing, rpm prints "package Paseo is not
    # installed" to stdout.
    installed_vr() { if installed; then rpm -q --qf '%{VERSION}-%{RELEASE}' Paseo; fi; }
    old_vr="$(installed_vr)"
    action=install
    if [[ -n "$old_vr" ]]; then
      case "$(rpm --eval "%{lua: print(rpm.vercmp(\"$old_vr\", \"$new_vr\"))}")" in
        0) action=reinstall ;;
        1) action=downgrade ;;
      esac
    fi
    # dnf runs as root and can't read a private mktemp dir; hand it a world-readable copy.
    chmod 755 "$tmp" && chmod 644 "$tmp/paseo.rpm"
    if ! "${ROOT[@]}" dnf "$action" -y "$tmp/paseo.rpm" || [[ "$(installed_vr)" != "$new_vr" ]]; then
      now_vr="$(installed_vr)"
      installed && open_app
      die "dnf $action didn't install Paseo $new_vr (installed: ${now_vr:-nothing})."
    fi
  fi
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

app_running || open_app

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
