#!/bin/sh
# Builds the zip that the release links to: dist/MoveGrade.zip.
#
#   sh tools/package.sh
#
# `git archive` packs the committed tree, so the zip can never disagree with
# what is on the branch, and .gitattributes keeps the build inputs out of it.
# Everything unpacks into one MoveGrade/ folder, which is the folder you hand
# to chrome://extensions -> Load unpacked.
#
# The name is deliberately not versioned. It is what
# releases/latest/download/MoveGrade.zip resolves to, and that link only stays
# stable while every release attaches an asset of the same name; the version
# lives in the release tag and in manifest.json.
set -e

cd "$(dirname "$0")/.."
version=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' manifest.json | head -1)
out="dist/MoveGrade.zip"

mkdir -p dist
rm -f "$out"
git archive --format=zip --prefix=MoveGrade/ -o "$out" HEAD

echo "MoveGrade $version -> $out"
unzip -l "$out" | tail -1
