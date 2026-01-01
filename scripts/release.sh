#!/bin/bash
set -e

BUMP_TYPE="${1:-patch}"

if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "usage: ./scripts/release.sh [patch|minor|major]"
  exit 1
fi

CURRENT_VERSION=$(jq -r .version package.json)
echo "current version: $CURRENT_VERSION"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
case "$BUMP_TYPE" in
  major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
  minor) NEW_VERSION="$MAJOR.$((MINOR + 1)).0" ;;
  patch) NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
esac

echo "new version: $NEW_VERSION"

jq ".version = \"$NEW_VERSION\"" package.json > package.json.tmp && mv package.json.tmp package.json

git add package.json
git commit -m "v$NEW_VERSION"
git tag "v$NEW_VERSION"

echo ""
echo "created commit and tag v$NEW_VERSION"
echo "run 'git push && git push --tags' to trigger release"
