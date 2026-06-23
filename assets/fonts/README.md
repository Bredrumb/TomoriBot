# Bundled fonts

**Family:** Noto Sans JP (covers Latin + Japanese kana/kanji).
**License:** SIL Open Font License 1.1 (OFL) — redistribution/bundling permitted.
Full text: https://openfontlicense.org/  •  Source: https://fonts.google.com/noto/specimen/Noto+Sans+JP
**Used by:** the `/stats generate` infographic renderer (satori + @resvg/resvg-js), loaded as
Buffers at runtime and passed to both the layout (satori) and the rasterizer (resvg) so rendering
is independent of host fonts (the prod Alpine image installs none).

## Loaded fonts (the active pair)

- `NotoSansJP-Regular.ttf` — static instance, weight 400.
- `NotoSansJP-Bold.ttf` — static instance, weight 700.

These are the files the renderer loads. Register each as its own weight with satori; pass both
buffers to @resvg/resvg-js (`font.fontBuffers`, `loadSystemFonts: false`).

## Why static instances, not the variable font

`NotoSansJP-VF.ttf` (the original variable font) is **kept for provenance** but is **NOT loaded** —
satori's bundled `@shuding/opentype.js` fork **crashes parsing the VF's `fvar` table**
(`TypeError: undefined is not an object (evaluating 'names[p.parseUShort()]')`), so it cannot be
used at all. This is the documented variable-font trap, hit during the Phase 3 chunk-1 render spike.

The two static instances were pinned out of the VF with `fonttools` (no external download needed,
so the OFL family is unchanged):

```
python -m fontTools.varLib.instancer assets/fonts/NotoSansJP-VF.ttf wght=400 -o assets/fonts/NotoSansJP-Regular.ttf
python -m fontTools.varLib.instancer assets/fonts/NotoSansJP-VF.ttf wght=700 -o assets/fonts/NotoSansJP-Bold.ttf
```

Full instancing drops the `fvar` table (which is what broke satori) and sets `OS/2.usWeightClass`
to 400 / 700 respectively, yielding plain static TTFs (~5.8 MB each) that satori parses cleanly and
that render true bold (verified: regular vs bold glyph paths differ). Still Noto Sans JP, still OFL,
and far smaller than pan-CJK Noto Sans CJK (~16 MB/weight).
