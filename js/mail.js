import { resumePdfBase64 } from "./pdf.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SKILL = /\b(javascript|typescript|react|node\.?js|python|java|sql|aws|azure|docker|kubernetes|html|css|git|rest|api|agile|excel|communication|leadership|figma|c\+\+|c#|golang|php|angular|vue|next\.?js|mongodb|postgresql|linux|jira|scrum|testing|selenium|devops|graphql|redux|tailwind|express|django|flask|spring|kotlin|swift|android|ios|power bi|tableau|salesforce|sap|recruitment)\b/ig;

export function validEmail(value) {
  return EMAIL.test(String(value || "").trim());
}

export function hrFromJob(job, from) {
  const text = String(job || "");
  const own = String(from || "").trim().toLowerCase();
  const found = [];
  for (const match of text.matchAll(EMAIL_IN_TEXT)) {
    const email = match[0];
    if (email.toLowerCase() === own) continue;
    const around = text.slice(Math.max(0, match.index - 48), match.index + email.length + 48).toLowerCase();
    found.push({ email, hr: /hr|human resources|recruit|talent|career|hiring|apply/.test(around) });
  }
  return (found.find((item) => item.hr) || found[0])?.email || "";
}

export function jobKeywords(job) {
  const text = String(job || "");
  const words = new Set();
  for (const match of text.matchAll(SKILL)) {
    const word = match[0].replace(/\s+/g, " ").trim();
    words.add(word.length < 4 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1));
  }
  const section = text.split(/\n(?=\s*(requirements|qualifications|skills|tech stack|what you(?:'|’)ll bring)\b)/i)[1] || "";
  for (const line of section.split(/\n/).slice(0, 24)) {
    const clean = line.replace(/^[\s\-*•\d.)]+/, "").trim();
    if (!clean || clean.length > 42 || clean.split(/\s+/).length > 5) continue;
    if (/^(requirements|qualifications|skills|tech stack|what you(?:'|’)ll bring)\b/i.test(clean)) continue;
    words.add(clean.replace(/[.:;]+$/, ""));
  }
  return [...words].slice(0, 24);
}

export function tailorResume(resume, keywords) {
  const base = String(resume || "").replace(/\n*Keywords from this role\n[\s\S]*$/, "").trim();
  if (!keywords?.length) return base;
  return `${base}\n\nKeywords from this role\n${keywords.join(", ")}\n`;
}

export function mailErrors(mail) {
  const errors = [];
  if (!validEmail(mail?.from)) errors.push("from");
  if (!String(mail?.appPassword || "").replace(/\s+/g, "")) errors.push("password");
  if (!String(mail?.resume || "").trim()) errors.push("resume");
  if (!String(mail?.job || "").trim()) errors.push("job");
  const to = String(mail?.to || "").trim() || hrFromJob(mail?.job, mail?.from);
  if (!validEmail(to)) errors.push("to");
  return errors;
}

export function credentialsReady(mail) {
  return validEmail(mail?.from)
    && Boolean(String(mail?.appPassword || "").replace(/\s+/g, ""))
    && Boolean(String(mail?.resume || "").trim());
}

export function smtpRoute(email) {
  const domain = String(email || "").split("@")[1]?.toLowerCase() || "";
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) {
    return { host: "smtp-mail.outlook.com", port: 587, secure: false };
  }
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") {
    return { host: "smtp.mail.me.com", port: 587, secure: false };
  }
  if (domain === "yahoo.com" || domain === "ymail.com" || domain.endsWith(".yahoo.com")) {
    return { host: "smtp.mail.yahoo.com", port: 465, secure: true };
  }
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { host: "smtp.gmail.com", port: 465, secure: true };
  }
  return { host: `smtp.${domain}`, port: 465, secure: true };
}

function encodeHeader(value) {
  const text = String(value || "");
  if (/^[\t\x20-\x7E]*$/.test(text)) return text;
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

export function mailSubject(job) {
  const line = String(job || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "";
  const title = line.replace(/^job description\s*[:\-–]\s*/i, "").trim();
  if (!title) return "Application";
  const short = title.length > 90 ? `${title.slice(0, 87)}...` : title;
  return `Application: ${short}`;
}

export function mailText(mail, keywords = []) {
  const from = String(mail.from || "").trim();
  const listed = keywords.length ? `\n\nKeywords added to the resume: ${keywords.join(", ")}` : "";
  return `Hello,\n\nMy resume is attached as a PDF.${listed}\n\nRegards,\n${from}\n`;
}

function mimeBody(from, to, subject, text, pdfBase64) {
  const boundary = "screenova-resume";
  const plain = text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  const encoded = String(pdfBase64 || "").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plain,
    `--${boundary}`,
    "Content-Type: application/pdf; name=\"resume.pdf\"",
    "Content-Transfer-Encoding: base64",
    "Content-Disposition: attachment; filename=\"resume.pdf\"",
    "",
    encoded,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function smtpPlan(mail) {
  const from = String(mail.from || "").trim();
  const to = String(mail.to || "").trim() || hrFromJob(mail.job, from);
  const password = String(mail.appPassword || "").replace(/\s+/g, "");
  const route = smtpRoute(from);
  const keywords = jobKeywords(mail.job);
  const resume = tailorResume(mail.resume, keywords);
  const subject = mailSubject(mail.job);
  const text = mailText(mail, keywords);
  const data = mimeBody(from, to, subject, text, resumePdfBase64(resume));
  return { ...route, from, to, user: from, password, subject, keywords, resume, data };
}
