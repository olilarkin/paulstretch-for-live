#!/usr/bin/env bash
#
# upload-sdk-secrets.sh
#
# TODO: delete this script once @ableton-extensions/{sdk,cli} are published to
# npm. At that point switch package.json to a versioned dependency, drop the
# "Restore Extensions SDK + CLI" step from .github/workflows/release.yml, and
# delete the EXTENSIONS_{SDK,CLI}_TGZ_B64_* repo secrets.
#
# The Ableton Extensions SDK is not yet published to npm. This extension's
# package.json depends on it (and the CLI) via local file: tarballs:
#
#     "@ableton-extensions/sdk": "file:./vendor/ableton-extensions-sdk-<v>.tgz"
#     "@ableton-extensions/cli": "file:./vendor/ableton-extensions-cli-<v>.tgz"
#
# Those tarballs ship in the SDK distribution zip (extensions-sdk-<v>.zip);
# unzip it and drop them into vendor/ (both vendor/*.tgz and the zip are
# gitignored). On a CI runner they aren't checked in, so `npm ci` would fail.
# This script base64-encodes the vendor/ tarballs and stores them as GitHub
# Actions secrets. The release workflow (.github/workflows/release.yml) decodes
# them back into vendor/ before `npm ci`, so no edits to package.json are ever
# needed.
#
# IMPORTANT: package-lock.json pins each tarball's integrity (sha512), and
# `npm ci` enforces it — so the lockfile must be generated from the SAME bytes
# the secrets hold. This script refreshes package-lock.json from the vendor/
# tarballs after uploading, so the two can't drift. Commit the updated
# package-lock.json (and package.json if the version changed) together with
# re-uploading the secrets, or CI's `npm ci` will fail with EINTEGRITY.
#
# To bump the SDK/CLI version: unzip the new SDK distribution, drop the new
# ableton-extensions-{sdk,cli}-<v>.tgz into vendor/, update the file: specs in
# package.json, then re-run this script.
#
# GitHub caps a single secret at 48 KB, so each tarball is split into fixed-size
# base64 chunks across numbered secrets (…_1, …_2, …). The chunk counts below
# MUST match what release.yml concatenates — the script aborts if a tarball
# grows past its allocation so the two never drift silently.
#
# Run from anywhere; requires `gh` (authenticated with admin on the repo) and
# `npm`. Target repo is auto-detected from the working copy, or override with
# REPO_SLUG=owner/name.
#
# Usage:
#     scripts/upload-sdk-secrets.sh
#     REPO_SLUG=olilarkin/paulstretch-extension scripts/upload-sdk-secrets.sh

set -euo pipefail

# --- chunk allocation (keep in sync with release.yml) ------------------------
EXPECTED_SDK_CHUNKS=3
EXPECTED_CLI_CHUNKS=1
# base64 chars per secret. GitHub's "48 KB" cap is on the *encrypted* value;
# libsodium sealed-box + base64 expansion means the plaintext must stay well
# under that, so we use 32 KB to be safe.
CHUNK_SIZE=32000

# --- locate things -----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"                 # the paulstretch repo

REPO_SLUG="${REPO_SLUG:-$(cd "$EXT_DIR" && gh repo view --json nameWithOwner -q .nameWithOwner)}"
echo "→ Target repo: $REPO_SLUG"

# Resolve a dependency's file: tarball path the same way release.yml does, so
# the secrets always carry exactly what package.json (and the lockfile) point
# at. Prints an absolute path under EXT_DIR.
resolve_tgz() { # <dep key in package.json>
  local spec
  spec="$(cd "$EXT_DIR" && node -e "const p=require('./package.json');const k='$1';const s=(p.dependencies&&p.dependencies[k])||(p.devDependencies&&p.devDependencies[k]);if(!s){process.stderr.write('no dependency '+k+' in package.json\n');process.exit(1)}process.stdout.write(s)")"
  case "$spec" in
    file:*) : ;;
    *) echo "::error:: $1 is '$spec', not a file: tarball — nothing to upload." >&2; exit 1 ;;
  esac
  # strip "file:" and any leading "./" or "/"
  local rel="${spec#file:}"
  rel="${rel#./}"
  rel="${rel#/}"
  printf '%s' "$EXT_DIR/$rel"
}

# --- base64-chunk and upload one tarball -------------------------------------
# args: <dep key> <secret prefix> <expected chunk count>
chunk_and_upload() {
  local dep="$1" prefix="$2" expected="$3"
  local tgz
  tgz="$(resolve_tgz "$dep")"
  echo
  echo "→ $dep"
  echo "  tarball: ${tgz#$EXT_DIR/}"

  if [ ! -f "$tgz" ]; then
    echo "::error:: $tgz is missing. Unzip the SDK distribution and copy the" >&2
    echo "         ableton-extensions-*.tgz files into vendor/ first." >&2
    exit 1
  fi

  local b64 len n
  b64="$(base64 < "$tgz" | tr -d '\n')"
  len=${#b64}
  n=$(( (len + CHUNK_SIZE - 1) / CHUNK_SIZE ))
  echo "  $(( $(wc -c <"$tgz") / 1024 )) KB → $len base64 chars → $n chunk(s)"

  if [ "$n" -ne "$expected" ]; then
    echo "::error:: ${prefix} now needs $n chunk(s) but release.yml expects $expected." >&2
    echo "         Update EXPECTED_*_CHUNKS here AND the concatenation in release.yml." >&2
    exit 1
  fi

  local i off part
  for (( i = 1; i <= n; i++ )); do
    off=$(( (i - 1) * CHUNK_SIZE ))
    part="${b64:off:CHUNK_SIZE}"
    printf '%s' "$part" | gh secret set "${prefix}_${i}" --repo "$REPO_SLUG"
    echo "  ✓ set ${prefix}_${i} (${#part} chars)"
  done
}

chunk_and_upload "@ableton-extensions/sdk" "EXTENSIONS_SDK_TGZ_B64" "$EXPECTED_SDK_CHUNKS"
chunk_and_upload "@ableton-extensions/cli" "EXTENSIONS_CLI_TGZ_B64" "$EXPECTED_CLI_CHUNKS"

# Refresh package-lock.json from the very tarballs just uploaded, so the pinned
# integrity matches what CI will decode. --package-lock-only avoids touching
# node_modules.
echo
echo "→ refreshing package-lock.json from vendor/ tarballs…"
( cd "$EXT_DIR" && npm install --package-lock-only >/dev/null )
echo "  ✓ package-lock.json updated"

echo
echo "✓ Secrets uploaded to $REPO_SLUG."
echo "  Commit the refreshed package-lock.json (and package.json if the version"
echo "  changed), then tag a release (git tag vX.Y.Z && git push --tags) to build."
