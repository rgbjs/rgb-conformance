#!/bin/sh
# Pulls the engine and vector sources from an rgbjs checkout, then regenerates
# vectors/index.json, spec.html and the social cards, and runs the suite.
#
#   tools/refresh.sh /path/to/rgbjs
#
# Run by hand when rgbjs changes; review the diff before committing.
set -eu
RGBJS=${1:?usage: tools/refresh.sh /path/to/rgbjs}
cd "$(dirname "$0")/.."

rm -rf engine/src engine/wasm
cp -r "$RGBJS/src" "$RGBJS/wasm" engine/
echo "rgbjs $(git -C "$RGBJS" rev-parse --short HEAD)" > engine/VERSION

cp "$RGBJS/test/vectors/cli-invoices.json" vectors/
for line in v011 v012; do
  find "vectors/$line" -name '*.rgb' -delete
  for f in "$RGBJS/test/vectors/$line"/*; do
    case "$(basename "$f")" in
      README.md) ;;
      *.v0112.rgb) ;; # 0.11.2 format: not readable by the pinned 0.11.1, kept in rgbjs only
      *) cp "$f" "vectors/$line/" ;;
    esac
  done
  # SOURCES.md is rgbjs's README for these vectors, with links to rgbjs.
  sed -e "1s/.*/# $line vector sources/" \
      -e 's#`rust/gen-v011`#[`rust/gen-v011`](https://github.com/rgbjs/rgbjs/tree/gh-pages/rust/gen-v011)#g' \
      -e 's#`rust/gen-v012`#[`rust/gen-v012`](https://github.com/rgbjs/rgbjs/tree/gh-pages/rust/gen-v012)#g' \
      -e 's#`scripts/extract-vectors.py`#[`scripts/extract-vectors.py`](https://github.com/rgbjs/rgbjs/blob/gh-pages/scripts/extract-vectors.py)#g' \
      -e '/nia_transfer.v0112.rgb/d' \
      "$RGBJS/test/vectors/$line/README.md" > "vectors/$line/SOURCES.md"
done

node tools/make-vectors.mjs
node build.js
if python3 -c 'import PIL' 2>/dev/null; then python3 -I tools/og.py; else echo "Pillow missing: social cards not redrawn"; fi
node test.js
git status --short
