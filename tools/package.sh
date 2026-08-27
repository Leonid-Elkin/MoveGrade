#!/bin/sh
# Builds the zip that the release links to: dist/MoveGrade-<version>.zip.
#
#   sh tools/package.sh
#
# `git archive` packs the committed tree, so the zip can never disagree with
# what is on the branch, and .gitattributes keeps the build inputs out of it.
# Everything unpacks into one MoveGrade/ folder, which is the folder you hand
# to chrome://extensions -> Load unpacked.
set -e

cd "$(dirname "$0")/.."
version=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' manifest.json | head -1)
out="dist/MoveGrade-$version.zip"

mkdir -p dist
rm -f "$out"
git archive --format=zip --prefix=MoveGrade/ -o "$out" HEAD

echo "$out"
unzip -l "$out" | tail -1
