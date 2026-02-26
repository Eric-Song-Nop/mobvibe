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

# Update optionalDependencies versions in main package.json
for dep in $(jq -r '.optionalDependencies | keys[]' package.json); do
  jq --arg dep "$dep" --arg v "$VERSION" \
    '.optionalDependencies[$dep] = $v' package.json > tmp.json
  mv tmp.json package.json
done

echo "Platform packages published. Main package ready."
