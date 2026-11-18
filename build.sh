#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUNDLE_DIR="$ROOT/source/native-bundle"
TMP_DIR="${TMPDIR:-/tmp}/cloudvault-vercel-build-$$"

if [ ! -d "$BUNDLE_DIR" ] || ! ls "$BUNDLE_DIR"/part*.b64 >/dev/null 2>&1; then
  echo "CloudVault source bundle is missing: $BUNDLE_DIR" >&2
  exit 1
fi
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR" "$ROOT/public"
trap 'rm -rf "$TMP_DIR"' EXIT

cat "$BUNDLE_DIR"/part*.b64 | base64 -d | tar -xJ -C "$TMP_DIR"
cp -R "$TMP_DIR/web/." "$ROOT/public/"
