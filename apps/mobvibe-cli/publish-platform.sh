#!/bin/bash
set -euo pipefail

VERSION="$1"

# Publish all platform packages
for dir in npm/*/; do
  platform=$(basename "$dir")
  echo "Publishing @mobvibe/cli-${platform}@${VERSION}..."

  # Set version
  jq --arg v "$VERSION" '.version = $v' "${dir}package.json" > tmp.json
  mv tmp.json "${dir}package.json"

  # Verify binary exists
  if [ ! -d "${dir}bin" ]; then
    echo "ERROR: ${dir}bin/ not found. Run build:bin first."
    exit 1
  fi

  npm publish "${dir}" --access public --provenance
done

# Inject optionalDependencies into main package.json (not committed to git,
# only added at publish time to avoid lockfile chicken-and-egg issues)
PLATFORMS=("linux-x64" "linux-arm64" "darwin-x64" "darwin-arm64" "win32-x64")
OPT_DEPS="{}"
for p in "${PLATFORMS[@]}"; do
  OPT_DEPS=$(echo "$OPT_DEPS" | jq --arg pkg "@mobvibe/cli-${p}" --arg v "$VERSION" '. + {($pkg): $v}')
done
jq --argjson deps "$OPT_DEPS" '.optionalDependencies = $deps' package.json > tmp.json
mv tmp.json package.json

echo "Platform packages published. Main package ready."
