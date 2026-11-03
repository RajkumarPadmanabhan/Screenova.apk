const cache = new Map();

const PALETTES = [
  ["#14080c", "#6e2433", "#f0c7b0"],
  ["#0c1219", "#1d4468", "#e4c99a"],
  ["#121018", "#3c2a58", "#f0d7b8"],
  ["#101510", "#214538", "#e4c98a"],
  ["#1a100c", "#6a3a1c", "#f3d2b4"],
  ["#10131a", "#2a3548", "#d5deea"],
];

function hash(value) {
  let result = 0;
  for (const char of String(value || "")) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

function wrap(ctx, text, maxWidth) {
  const words = String(text || "Untitled").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export function artwork(title, year, wide = false) {
  const key = `${title}|${year || ""}|${wide ? "w" : "p"}`;
  if (cache.has(key)) return cache.get(key);
  const width = wide ? 1280 : 600;
  const height = wide ? 720 : 900;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const [deep, mid, light] = PALETTES[hash(title) % PALETTES.length];
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, deep);
  gradient.addColorStop(0.55, mid);
  gradient.addColorStop(1, deep);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = light;
  ctx.globalAlpha = 0.14;
  ctx.beginPath();
  ctx.arc(width * 0.78, height * 0.18, wide ? 220 : 180, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = light;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(wide ? 72 : 40, height - (wide ? 168 : 210));
  ctx.lineTo(wide ? 168 : 110, height - (wide ? 168 : 210));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${wide ? 64 : 48}px Inter, sans-serif`;
  ctx.textBaseline = "top";
  const lines = wrap(ctx, title, width - (wide ? 140 : 80));
  const lineHeight = wide ? 74 : 56;
  let y = height - (wide ? 150 : 170) - (lines.length - 1) * lineHeight;
  for (const line of lines) {
    ctx.fillText(line, wide ? 72 : 40, y);
    y += lineHeight;
  }
  if (year) {
    ctx.fillStyle = light;
    ctx.font = "600 22px Inter, sans-serif";
    ctx.fillText(String(year), wide ? 72 : 40, 48);
  }
  const url = canvas.toDataURL("image/jpeg", 0.86);
  cache.set(key, url);
  return url;
}
