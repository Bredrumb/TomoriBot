/**
 * statsInfographic.tsx — satori (JSX → SVG) layer for the `/stats generate`
 * infographic (plans/stat-tracking.md §10, Phase 3).
 *
 * SCOPE — CHUNK 1 (font + render spike GATE) ONLY. This file currently exposes:
 *   1. the hand-rolled JSX factory satori needs (`h` / `Fragment`), and
 *   2. throwaway "spike" renderers used to prove the
 *      satori → SVG → @resvg/resvg-js → PNG pipeline can render Latin + Japanese
 *      text from a bundled font *buffer*, independent of host fonts.
 * Real card layouts, command wiring, and locale keys land in LATER chunks — do
 * not add them here yet.
 *
 * Why a hand-rolled JSX factory instead of React: satori consumes a
 * React-element-*shaped* tree (`{ type, props: { children, ...style } }`) but
 * the project has no React dependency. `h` builds exactly that shape, so tsc /
 * Bun transpile the JSX in this file through the classic factory
 * (tsconfig: `"jsx": "react"`, `"jsxFactory": "h"`, `"jsxFragmentFactory":
 * "Fragment"`) with zero React runtime. satori's published signature types its
 * element param as `react`'s `ReactNode`; with no `@types/react` present that
 * resolves loosely, so passing our typed {@link VNode} is accepted.
 */
import satori from "satori";

/**
 * A satori-compatible virtual node — the React-element shape satori walks
 * (`type` + `props`, children living inside `props.children`).
 */
export interface VNode {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}

/**
 * Minimal JSX typing so tsc accepts intrinsic tags (`div`, `span`, `img`, …) with
 * the classic `h` factory and no React types installed. Every element produces a
 * {@link VNode}; any tag with any props is allowed (satori validates the real
 * subset at render time).
 */
declare global {
  namespace JSX {
    type Element = VNode;
    interface IntrinsicElements {
      [tag: string]: Record<string, unknown> & { children?: unknown };
    }
  }
}

/**
 * Classic JSX factory. Called by transpiled JSX as `h(type, props, ...children)`
 * and returns the {@link VNode} shape satori expects. Children are flattened one
 * level (JSX expands `{array}` children into a nested array) and collapsed to a
 * single child / `undefined` so satori sees the same shape React would emit.
 *
 * @param type     - Intrinsic element tag (satori supports `div`, `span`, `img`, …).
 * @param props    - Element props (style + attributes), or null when none.
 * @param children - Child nodes / text, possibly nested one level by JSX.
 */
export function h(type: string, props: Record<string, unknown> | null, ...children: unknown[]): VNode {
  // 1. Flatten one level: JSX passes `{items}` as a single array argument.
  const flat = children.flat();
  // 2. Mirror React's children normalization (none → undefined, one → bare).
  const kids = flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat;
  return { type, props: { ...(props ?? {}), children: kids } };
}

/**
 * Fragment placeholder for `jsxFragmentFactory`. satori has no real fragment
 * concept, so the spike cards never use `<>…</>`; this exists only to satisfy
 * the configured factory name. Returns its children untouched.
 */
export function Fragment(props: { children?: unknown }): unknown {
  return props.children;
}

/**
 * One font registered with both satori and @resvg/resvg-js. `data` is a raw
 * `.ttf` buffer loaded from `assets/fonts/` — the whole point of the stack is
 * that both stages take the buffer directly, so rendering does not depend on
 * any host-installed / fontconfig-resolvable font (Alpine ships none).
 */
export interface SpikeFont {
  /** Font family name referenced by `font-family` in styles. */
  name: string;
  /** Raw TTF/OTF bytes. */
  data: Buffer;
  /** Weight this buffer is registered as (400 = regular, 700 = bold). */
  weight: 400 | 700;
}

/** Fixed dimensions for the spike card (real cards size themselves in later chunks). */
const SPIKE_WIDTH = 600;
const SPIKE_HEIGHT = 320;

/**
 * Renders the spike card to an SVG string via satori. The card deliberately
 * mixes English and Japanese AND a regular-vs-bold pair so a human (or the
 * extracted-PNG check) can confirm, inside the Alpine image, that:
 *   • Japanese glyphs rasterize from the bundled buffer (not tofu/boxes), and
 *   • the bold row is visibly heavier than the regular row (the VF weight-axis
 *     caveat — see assets/fonts/README.md).
 *
 * @param fonts - Font buffers to register with satori (regular + optional bold).
 */
export async function renderSpikeSvg(fonts: SpikeFont[]): Promise<string> {
  const family = fonts[0]?.name ?? "Noto Sans JP";
  const element: VNode = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: 32,
        backgroundColor: "#1e1f22",
        color: "#ffffff",
        fontFamily: family,
      }}
    >
      <div style={{ display: "flex", fontSize: 40, fontWeight: 700, marginBottom: 12 }}>Activity / 日本語テスト</div>
      <div style={{ display: "flex", fontSize: 24, fontWeight: 400, marginBottom: 24 }}>
        Regular 400 — こんにちは、世界
      </div>
      <div style={{ display: "flex", fontSize: 24, fontWeight: 700 }}>Bold 700 — こんにちは、世界</div>
    </div>
  );
  return satori(element, { width: SPIKE_WIDTH, height: SPIKE_HEIGHT, fonts });
}

/**
 * Renders a single string at exactly one weight, used by the spike to PROVE the
 * bold axis works: rendering the same text at 400 vs 700 and diffing the emitted
 * SVG glyph paths is deterministic — identical path data means the weight axis
 * was ignored (the variable-font trap), differing data means bold rasterizes.
 *
 * @param text   - The probe string (use one with Latin + kana for coverage).
 * @param weight - 400 or 700.
 * @param fonts  - Font buffers to register with satori.
 */
export async function renderWeightProbeSvg(text: string, weight: 400 | 700, fonts: SpikeFont[]): Promise<string> {
  const family = fonts[0]?.name ?? "Noto Sans JP";
  const element: VNode = (
    <div style={{ display: "flex", fontSize: 48, fontWeight: weight, fontFamily: family, color: "#000000" }}>
      {text}
    </div>
  );
  return satori(element, { width: 480, height: 96, fonts });
}
