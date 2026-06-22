# Bundled fonts

## NotoSansJP-VF.ttf

- **Family:** Noto Sans JP (covers Latin + Japanese kana/kanji).
- **License:** SIL Open Font License 1.1 (OFL) — redistribution/bundling permitted.
  Full text: https://openfontlicense.org/  •  Source: https://fonts.google.com/noto/specimen/Noto+Sans+JP
- **Used by:** the `/stats generate` infographic renderer (satori + @resvg/resvg-js), loaded as a
  Buffer at runtime and passed to both the layout (satori) and the rasterizer (resvg) so rendering
  is independent of host fonts (the prod Alpine image installs none).

> ⚠️ **This is a Variable Font (`-VF`).** satori and @resvg/resvg-js do not reliably support the
> variable weight axis — bold (`font-weight: 700`) may be ignored and everything may render at the
> default weight. If weight rendering misbehaves, replace this with static instances
> (`NotoSansJP-Regular.ttf` + `NotoSansJP-Bold.ttf`) from the Google Fonts / Noto release and
> register each weight separately. The VF is bundled as a spike-grade starting point.
