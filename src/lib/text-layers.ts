// Text Studio: layer model + canvas renderer (client-side; fonts are self-hosted).
export const FONTS = [
  { key: "anton", label: "Anton (impact)", family: "Anton", weight: 400 },
  { key: "bebas", label: "Bebas Neue", family: "Bebas Neue", weight: 400 },
  { key: "montserrat", label: "Montserrat", family: "Montserrat Variable", weight: 800 },
  { key: "inter", label: "Inter", family: "Inter Variable", weight: 700 },
  { key: "oswald", label: "Oswald", family: "Oswald Variable", weight: 700 },
  { key: "playfair", label: "Playfair (elegant)", family: "Playfair Display Variable", weight: 700 },
  { key: "fraunces", label: "Fraunces (editorial)", family: "Fraunces Variable", weight: 650 },
  { key: "pacifico", label: "Pacifico (script)", family: "Pacifico", weight: 400 },
  { key: "lobster", label: "Lobster (retro)", family: "Lobster", weight: 400 },
  { key: "marker", label: "Permanent Marker", family: "Permanent Marker", weight: 400 },
  { key: "caveat", label: "Caveat (handwritten)", family: "Caveat", weight: 700 },
] as const;
export type FontKey = (typeof FONTS)[number]["key"];

export type Frame = "none" | "box" | "pill" | "outline" | "banner";
export type Shadow = "none" | "soft" | "hard" | "glow";

export type TextLayer = {
  id: string;
  text: string;
  font: FontKey;
  italic: boolean;
  upper: boolean;
  size: number; // font size as a fraction of image width
  color: string;
  strokeColor: string;
  stroke: number; // outline thickness as a fraction of font size (0 = none)
  shadow: Shadow;
  frame: Frame;
  frameColor: string;
  frameOpacity: number;
  padding: number; // fraction of font size
  align: "left" | "center" | "right";
  letterSpacing: number; // em
  lineHeight: number;
  rotation: number; // degrees
  opacity: number;
  x: number; // center, 0..1 of image width
  y: number; // center, 0..1 of image height
};

let counter = 0;
export function newLayer(over: Partial<TextLayer> = {}): TextLayer {
  return {
    id: `t${Date.now()}${counter++}`, text: "Your text", font: "montserrat", italic: false, upper: false, size: 0.07,
    color: "#ffffff", strokeColor: "#000000", stroke: 0, shadow: "soft", frame: "none", frameColor: "#000000", frameOpacity: 0.55,
    padding: 0.45, align: "center", letterSpacing: 0, lineHeight: 1.15, rotation: 0, opacity: 1, x: 0.5, y: 0.5, ...over,
  };
}

/** One-click looks (applied to the selected layer, keeping its text and position). */
export const LOOKS: Array<{ key: string; label: string; patch: Partial<TextLayer> }> = [
  { key: "youtube", label: "YouTube bold", patch: { font: "anton", upper: true, italic: false, size: 0.11, color: "#ffe600", strokeColor: "#000000", stroke: 0.12, shadow: "hard", frame: "none", letterSpacing: 0.01 } },
  { key: "meme", label: "Meme", patch: { font: "anton", upper: true, italic: false, size: 0.085, color: "#ffffff", strokeColor: "#000000", stroke: 0.11, shadow: "none", frame: "none" } },
  { key: "quote", label: "Elegant quote", patch: { font: "playfair", italic: true, upper: false, size: 0.055, color: "#ffffff", stroke: 0, shadow: "none", frame: "box", frameColor: "#000000", frameOpacity: 0.45, padding: 0.6 } },
  { key: "sale", label: "Sale badge", patch: { font: "bebas", upper: true, italic: false, size: 0.09, color: "#ffffff", stroke: 0, shadow: "soft", frame: "pill", frameColor: "#ff2d55", frameOpacity: 1, padding: 0.45, letterSpacing: 0.04 } },
  { key: "handwritten", label: "Handwritten", patch: { font: "marker", upper: false, italic: false, size: 0.07, color: "#ffffff", stroke: 0, shadow: "soft", frame: "none" } },
  { key: "neon", label: "Neon glow", patch: { font: "montserrat", upper: true, italic: false, size: 0.07, color: "#ff5ef4", stroke: 0, shadow: "glow", frame: "none", letterSpacing: 0.06 } },
  { key: "caption", label: "Caption bar", patch: { font: "inter", upper: false, italic: false, size: 0.042, color: "#ffffff", stroke: 0, shadow: "none", frame: "banner", frameColor: "#000000", frameOpacity: 0.6, padding: 0.6, y: 0.9 } },
  { key: "editorial", label: "Magazine", patch: { font: "fraunces", upper: false, italic: true, size: 0.1, color: "#ffffff", stroke: 0, shadow: "soft", frame: "none", letterSpacing: -0.01 } },
];

export function fontOf(l: TextLayer) {
  return FONTS.find((f) => f.key === l.font) ?? FONTS[0];
}
export function cssFont(l: TextLayer, px: number) {
  const f = fontOf(l);
  return `${l.italic ? "italic " : ""}${f.weight} ${Math.max(1, Math.round(px))}px "${f.family}"`;
}

function hexToRgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export type Box = { id: string; cx: number; cy: number; hw: number; hh: number };

/** Draws one layer onto a canvas of size W×H and returns its (unrotated) box for hit-testing. */
export function drawLayer(ctx: CanvasRenderingContext2D, l: TextLayer, W: number, H: number): Box {
  const px = l.size * W;
  const lines = (l.upper ? l.text.toUpperCase() : l.text).split("\n");
  ctx.save();
  ctx.font = cssFont(l, px);
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${l.letterSpacing * px}px`;
  const widths = lines.map((t) => ctx.measureText(t).width);
  const maxW = Math.max(1, ...widths);
  const lineH = px * l.lineHeight;
  const totalH = lineH * lines.length;
  const pad = l.padding * px;
  const cx = l.x * W;
  const cy = l.y * H;
  ctx.translate(cx, cy);
  ctx.rotate((l.rotation * Math.PI) / 180);
  ctx.globalAlpha = l.opacity;

  const bw = maxW + pad * 2;
  const bh = totalH + pad * 2;
  if (l.frame !== "none") {
    ctx.fillStyle = hexToRgba(l.frameColor, l.frameOpacity);
    ctx.strokeStyle = hexToRgba(l.frameColor, Math.max(l.frameOpacity, 0.9));
    ctx.beginPath();
    if (l.frame === "banner") ctx.rect(-cx - 2, -bh / 2, W + 4, bh);
    else ctx.roundRect(-bw / 2, -bh / 2, bw, bh, l.frame === "pill" ? bh / 2 : l.frame === "box" ? px * 0.18 : px * 0.12);
    if (l.frame === "outline") {
      ctx.lineWidth = Math.max(2, px * 0.07);
      ctx.stroke();
    } else ctx.fill();
  }

  ctx.textBaseline = "middle";
  ctx.textAlign = l.align;
  const tx = l.align === "center" ? 0 : l.align === "left" ? -maxW / 2 : maxW / 2;
  lines.forEach((t, i) => {
    const ty = -totalH / 2 + lineH * (i + 0.5);
    if (l.shadow !== "none") {
      ctx.shadowColor = l.shadow === "glow" ? l.color : "rgba(0,0,0,0.65)";
      ctx.shadowBlur = l.shadow === "glow" ? px * 0.45 : l.shadow === "soft" ? px * 0.18 : 0;
      ctx.shadowOffsetX = l.shadow === "hard" ? px * 0.06 : 0;
      ctx.shadowOffsetY = l.shadow === "hard" ? px * 0.06 : l.shadow === "soft" ? px * 0.04 : 0;
    }
    if (l.stroke > 0) {
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = l.stroke * px * 2;
      ctx.strokeStyle = l.strokeColor;
      ctx.strokeText(t, tx, ty);
      ctx.shadowColor = "transparent";
    }
    ctx.fillStyle = l.color;
    ctx.fillText(t, tx, ty);
    if (l.shadow === "glow") ctx.fillText(t, tx, ty); // double pass for a stronger glow
    ctx.shadowColor = "transparent";
  });
  ctx.restore();
  return { id: l.id, cx, cy, hw: l.frame === "banner" ? W / 2 : bw / 2, hh: bh / 2 };
}
