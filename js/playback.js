const MOVI_URL = "https://cdn.jsdelivr.net/npm/movi-player@0.4.1/dist/element.slim.js";
const WASM_URL = "https://cdn.jsdelivr.net/npm/movi-player@0.4.1/dist/movi.wasm";
const NATIVE = new Set(["mp4", "m4v", "webm", "mov", "ogv", "ogg"]);

const LANGUAGES = {
  en: "English",
  eng: "English",
  english: "English",
  hi: "Hindi",
  hin: "Hindi",
  hindi: "Hindi",
  ta: "Tamil",
  tam: "Tamil",
  tamil: "Tamil",
  te: "Telugu",
  tel: "Telugu",
  telugu: "Telugu",
  ml: "Malayalam",
  mal: "Malayalam",
  malayalam: "Malayalam",
  kn: "Kannada",
  kan: "Kannada",
  kannada: "Kannada",
  es: "Spanish",
  spa: "Spanish",
  spanish: "Spanish",
  fr: "French",
  fre: "French",
  fra: "French",
  french: "French",
  de: "German",
  ger: "German",
  deu: "German",
  german: "German",
  ja: "Japanese",
  jpn: "Japanese",
  japanese: "Japanese",
  ko: "Korean",
  kor: "Korean",
  korean: "Korean",
  zh: "Chinese",
  chi: "Chinese",
  zho: "Chinese",
  chinese: "Chinese",
  ar: "Arabic",
  ara: "Arabic",
  arabic: "Arabic",
  pt: "Portuguese",
  por: "Portuguese",
  portuguese: "Portuguese",
  ru: "Russian",
  rus: "Russian",
  russian: "Russian",
  it: "Italian",
  ita: "Italian",
  italian: "Italian",
};

let moviPromise = null;

export function loadMovi() {
  if (typeof customElements !== "undefined" && customElements.get("movi-player")) return Promise.resolve(true);
  if (!moviPromise) {
    moviPromise = import(MOVI_URL)
      .then(() => customElements.whenDefined("movi-player"))
      .then(() => true)
      .catch((error) => {
        moviPromise = null;
        throw error;
      });
  }
  return moviPromise;
}

export function moviWasmUrl() {
  return WASM_URL;
}

export async function fileWantsDemux(file, ext) {
  const kind = String(ext || "").toLowerCase();
  if (!["mp4", "m4v", "mov"].includes(kind)) return !NATIVE.has(kind);
  try {
    const counts = await handlerCounts(file);
    return counts.audio > 1 || counts.sub > 0;
  } catch {
    return false;
  }
}

async function handlerCounts(file) {
  const size = file.size || 0;
  const chunk = 6 * 1024 * 1024;
  const parts = [file.slice(0, Math.min(chunk, size))];
  if (size > chunk) parts.push(file.slice(Math.max(0, size - chunk)));
  const buffers = await Promise.all(parts.map((part) => part.arrayBuffer()));
  let audio = 0;
  let sub = 0;
  for (const buffer of buffers) {
    const bytes = new Uint8Array(buffer);
    for (let i = 4; i < bytes.length - 16; i += 1) {
      if (bytes[i] !== 0x68 || bytes[i + 1] !== 0x64 || bytes[i + 2] !== 0x6c || bytes[i + 3] !== 0x72) continue;
      const box = (bytes[i - 4] << 24) | (bytes[i - 3] << 16) | (bytes[i - 2] << 8) | bytes[i - 1];
      if (box < 32 || box > 2000000) continue;
      const type = String.fromCharCode(bytes[i + 12], bytes[i + 13], bytes[i + 14], bytes[i + 15]);
      if (type === "soun") audio += 1;
      else if (type === "subt" || type === "sbtl" || type === "text") sub += 1;
    }
  }
  return { audio, sub };
}

export function languageFromName(name) {
  const stem = String(name || "").replace(/\.[^.]+$/, "");
  const tokens = stem.split(/[._\-\s()[\]]+/).filter(Boolean).reverse();
  for (const token of tokens) {
    const label = LANGUAGES[token.toLowerCase()];
    if (label) return { code: token.toLowerCase().slice(0, 2), label };
  }
  return { code: "und", label: stem || "Subtitle" };
}

export function subtitleLabel(name) {
  const found = languageFromName(name);
  return found.label === String(name || "").replace(/\.[^.]+$/, "") ? found.label : found.label;
}

function srtToVtt(text) {
  return `WEBVTT\n\n${text.replace(/^\uFEFF/, "").replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}

function assClock(value) {
  const match = String(value || "").trim().match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,3})$/);
  if (!match) return "00:00:00.000";
  const fraction = match[4].padEnd(3, "0").slice(0, 3);
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3]}.${fraction}`;
}

function assToVtt(text) {
  let startIdx = 1;
  let endIdx = 2;
  let textIdx = 9;
  const format = text.match(/^Format:\s*(.+)$/im);
  if (format) {
    const fields = format[1].split(",").map((item) => item.trim().toLowerCase());
    if (fields.includes("start") && fields.includes("end") && fields.includes("text")) {
      startIdx = fields.indexOf("start");
      endIdx = fields.indexOf("end");
      textIdx = fields.indexOf("text");
    }
  }
  const cues = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("Dialogue:")) continue;
    const parts = line.slice("Dialogue:".length).split(",");
    if (parts.length <= textIdx) continue;
    const body = parts.slice(textIdx).join(",")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " ")
      .trim();
    if (!body) continue;
    cues.push(`${cues.length + 1}\n${assClock(parts[startIdx])} --> ${assClock(parts[endIdx])}\n${body}`);
  }
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export function textToVtt(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "").replace(/\r/g, "");
  if (/^WEBVTT/i.test(clean)) return clean;
  if (/^\[Script Info\]/im.test(clean) || /^Dialogue:/m.test(clean)) return assToVtt(clean);
  return srtToVtt(clean);
}

export async function vttFile(file) {
  const name = file.name || "subtitle.vtt";
  const text = textToVtt(await file.text());
  const vttName = name.replace(/\.[^.]+$/, "") + ".vtt";
  return new File([text], vttName, { type: "text/vtt" });
}
