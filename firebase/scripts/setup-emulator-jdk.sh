#!/bin/bash
# Puts Java 21+ on PATH for the Firestore emulator.
# Uses a JDK already on the machine when it is 21 or newer.
# Otherwise downloads Eclipse Temurin 21 JRE into firebase/.tools/jdk (gitignored)
# and reuses that directory on later runs.
#
# Source this script so JAVA_HOME is exported to the caller:
#   source firebase/scripts/setup-emulator-jdk.sh
set -euo pipefail

FIREBASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_HOME="$FIREBASE_DIR/.tools/jdk"

java_major() {
  local bin="$1"
  "$bin" -version 2>&1 | sed -n 's/.* version "\([0-9][0-9]*\).*/\1/p' | head -1
}

select_home() {
  if command -v java >/dev/null 2>&1; then
    local major
    major="$(java_major "$(command -v java)" || true)"
    if [ -n "${major}" ] && [ "$major" -ge 21 ]; then
      if /usr/libexec/java_home -v "$major" >/dev/null 2>&1; then
        /usr/libexec/java_home -v "$major"
        return
      fi
      # java is on PATH but not registered with java_home. Use its real prefix.
      local bin
      bin="$(command -v java)"
      (cd "$(dirname "$bin")/.." && pwd)
      return
    fi
  fi

  if [ -x "$TOOLS_HOME/bin/java" ]; then
    local major
    major="$(java_major "$TOOLS_HOME/bin/java" || true)"
    if [ -n "${major}" ] && [ "$major" -ge 21 ]; then
      echo "$TOOLS_HOME"
      return
    fi
  fi

  local arch temurin_arch
  arch="$(uname -m)"
  case "$arch" in
    arm64) temurin_arch="aarch64" ;;
    x86_64) temurin_arch="x64" ;;
    *)
      echo "Unsupported architecture: $arch" >&2
      return 1
      ;;
  esac

  echo "No Java 21+ found. Downloading Temurin 21 JRE into firebase/.tools/jdk" >&2
  local tmp home_dir
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/jre.tar.gz" \
    "https://api.adoptium.net/v3/binary/latest/21/ga/mac/${temurin_arch}/jre/hotspot/normal/eclipse?project=jdk"
  tar -xzf "$tmp/jre.tar.gz" -C "$tmp"
  home_dir="$(echo "$tmp"/*/Contents/Home)"
  if [ ! -x "$home_dir/bin/java" ]; then
    echo "Temurin archive did not contain Contents/Home/bin/java" >&2
    rm -rf "$tmp"
    return 1
  fi
  mkdir -p "$TOOLS_HOME"
  cp -R "$home_dir/." "$TOOLS_HOME/"
  rm -rf "$tmp"
  echo "$TOOLS_HOME"
}

JAVA_HOME="$(select_home)"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "JAVA_HOME=$JAVA_HOME"
  java -version
fi
