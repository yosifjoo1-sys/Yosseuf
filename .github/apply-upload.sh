#!/usr/bin/env bash
# Extracts an uploaded .zip over the repo, then re-applies the Vercel adapter.
set -euo pipefail
Z="${1:-$(git ls-files '*.zip' | head -1)}"
[ -z "$Z" ] || [ ! -f "$Z" ] && { echo "no zip found"; exit 0; }
echo "Applying $Z"
keep=$(mktemp -d)
cp api/index.js "$keep/index.js"; cp vercel.json "$keep/vercel.json"; cp -r .github "$keep/github"
tmp=$(mktemp -d); unzip -oq "$Z" -d "$tmp/x"; rm -rf "$tmp/x/__MACOSX"
src="$tmp/x"
while [ ! -f "$src/server.js" ] && [ ! -f "$src/package.json" ] && [ "$(ls -A "$src" | wc -l)" = 1 ] && [ -d "$src/$(ls -A "$src")" ]; do src="$src/$(ls -A "$src")"; done
git rm -q --cached "$Z"; rm -f "$Z"
rsync -a --exclude .git --exclude node_modules --exclude .env --exclude data --exclude workspace --exclude '*.zip' "$src"/ ./
mkdir -p api; cp "$keep/index.js" api/index.js; cp "$keep/vercel.json" vercel.json; rm -rf .github; cp -r "$keep/github" .github
if [ -f lib/store.js ] && ! grep -q 'process.env.VERCEL' lib/store.js; then
  sed -i 's|: APP;|: process.env.VERCEL ? "/tmp/mrjoo" : APP;|' lib/store.js
fi
if [ -f server.js ] && ! grep -q 'export const server' server.js; then
  sed -i 's|^const server = http.createServer|export const server = http.createServer|' server.js
fi
grep -q 'export const server' server.js || { echo "ERROR: server.js must export 'server'"; exit 1; }
node -e 'import("./server.js").then(()=>{console.log("server.js loads OK");process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})'
