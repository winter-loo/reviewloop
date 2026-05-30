#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
package_root="$repo_root/dist/ltsql-review-platform"
tarball="$repo_root/dist/ltsql-review-platform.tar.gz"

rm -rf "$package_root" "$tarball"
mkdir -p "$package_root"

cp -R "$repo_root/build" "$package_root/build"
cp -R "$repo_root/dist-cli" "$package_root/dist-cli"
cp "$repo_root/package.json" "$package_root/package.json"
cp "$repo_root/README.md" "$package_root/README.md"
cp "$repo_root/scripts/start-ltsql-review.sh" "$package_root/start-ltsql-review.sh"
chmod +x "$package_root/start-ltsql-review.sh" "$package_root/dist-cli/ltsql-review.js"

(
	cd "$repo_root/dist"
	tar -czf "$(basename "$tarball")" ltsql-review-platform
)

printf 'Created %s\n' "$tarball"
