import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { hrFromJob, jobKeywords, mailErrors, mailSubject, mailText, smtpPlan, smtpRoute, tailorResume } from "../js/mail.js";
import { sendSmtp } from "../server/smtp.mjs";

const mail = {
  from: "person@gmail.com",
  to: "hr@studio.test",
  appPassword: "abcd efgh ijkl mnop",
  resume: "Ada Lovelace\nEngineer",
  job: "Frontend engineer\nSend the resume to hr@studio.test\nRequirements\nReact\nNode.js",
};

test("builds the HR message from the job description and keeps the app password out of it", () => {
  assert.deepEqual(mailErrors(mail), []);
  assert.equal(mailSubject(mail.job), "Application: Frontend engineer");
  const text = mailText(mail, jobKeywords(mail.job));
  assert.match(text, /resume is attached as a PDF/);
  assert.match(text, /React/);
  assert.equal(text.includes("abcd"), false);
  assert.equal(hrFromJob(mail.job, mail.from), "hr@studio.test");
  const words = jobKeywords(mail.job);
  const resume = tailorResume(mail.resume, words);
  assert.match(resume, /Ada Lovelace/);
  assert.match(resume, /Keywords from this role/);
  assert.match(resume, /React/);
  const plan = smtpPlan({ ...mail, to: "" });
  assert.equal(plan.host, "smtp.gmail.com");
  assert.equal(plan.port, 465);
  assert.equal(plan.secure, true);
  assert.equal(plan.password, "abcdefghijklmnop");
  assert.match(plan.data, /From: person@gmail.com/);
  assert.match(plan.data, /To: hr@studio.test/);
  assert.match(plan.data, /Frontend engineer/);
  assert.match(plan.data, /application\/pdf/);
  assert.match(plan.data, /filename="resume.pdf"/);
  assert.equal(plan.data.includes(plan.password), false);
  const pdf = Buffer.from(plan.data.split('filename="resume.pdf"')[1].split("--screenova-resume--")[0].replace(/\s/g, ""), "base64").toString("latin1");
  assert.match(pdf, /^%PDF/);
  assert.match(pdf, /Ada Lovelace/);
  assert.match(pdf, /React/);
  assert.equal(smtpRoute("hr@outlook.com").host, "smtp-mail.outlook.com");
  assert.deepEqual(mailErrors({ from: "person@gmail.com", to: "", appPassword: "", job: "" }).sort(), ["job", "password", "resume", "to"]);
});

test("signs in and sends the job description over SMTP", async () => {
  const received = [];
  const server = net.createServer((socket) => {
    socket.write("220 ready\r\n");
    let buffer = "";
    let mode = "command";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (mode === "data") {
        if (!buffer.includes("\r\n.\r\n")) return;
        received.push(buffer);
        buffer = "";
        mode = "command";
        socket.write("250 queued\r\n");
        return;
      }
      while (buffer.includes("\r\n")) {
        const nl = buffer.indexOf("\r\n");
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        received.push(line);
        if (line === "AUTH LOGIN" || line === Buffer.from(mail.from).toString("base64")) socket.write("334 go\r\n");
        else if (line === "DATA") {
          mode = "data";
          socket.write("354 go\r\n");
        } else if (line === "QUIT") socket.write("221 bye\r\n");
        else if (line.startsWith("EHLO") || line.startsWith("MAIL") || line.startsWith("RCPT")) socket.write("250 ok\r\n");
        else socket.write("235 ok\r\n");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const plan = smtpPlan(mail);
    await sendSmtp({ ...plan, host: "127.0.0.1", port, secure: false, starttls: false });
  } finally {
    server.close();
  }
  const data = received.find((line) => line.includes("Frontend engineer"));
  assert.ok(data);
  assert.match(data, /To: hr@studio.test/);
  assert.equal(data.includes("abcdefghijklmnop"), false);
  assert.ok(received.includes(Buffer.from("abcdefghijklmnop").toString("base64")));
});
