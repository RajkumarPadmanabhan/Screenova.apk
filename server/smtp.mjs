import net from "node:net";
import tls from "node:tls";

function connect({ host, port, secure, socket }) {
  return new Promise((resolve, reject) => {
    const next = socket
      ? tls.connect({ socket, servername: host })
      : secure
        ? tls.connect({ host, port, servername: host })
        : net.connect({ host, port });
    const ready = secure || socket ? "secureConnect" : "connect";
    const fail = (error) => {
      next.off(ready, done);
      reject(error);
    };
    const done = () => {
      next.off("error", fail);
      resolve(next);
    };
    next.once(ready, done);
    next.once("error", fail);
  });
}

function createReader(socket) {
  let buffer = "";
  const queue = [];
  let waiter = null;
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    drain();
  });
  socket.on("error", (error) => {
    const current = waiter;
    waiter = null;
    queue.length = 0;
    if (current) current.reject(error);
  });
  function takeReply() {
    const lines = [];
    while (buffer.includes("\n")) {
      const nl = buffer.indexOf("\n");
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lines.push(line);
      if (/^\d{3} /.test(line)) return { code: Number(line.slice(0, 3)), text: lines.join("\n") };
    }
    return null;
  }
  function drain() {
    if (!waiter) return;
    const reply = takeReply();
    if (!reply) return;
    const current = waiter;
    waiter = queue.shift() || null;
    current.resolve(reply);
    if (waiter) drain();
  }
  return {
    next() {
      return new Promise((resolve, reject) => {
        const item = { resolve, reject };
        if (!waiter) {
          waiter = item;
          drain();
        } else queue.push(item);
      });
    },
  };
}

async function command(socket, reader, line, expected) {
  socket.write(`${line}\r\n`);
  const reply = await reader.next();
  if (!expected.includes(reply.code)) {
    throw new Error(`Mail server replied ${reply.code}`);
  }
  return reply;
}

export async function sendSmtp({ host, port, secure, starttls, from, to, user, password, data }) {
  let socket = await connect({ host, port, secure });
  let reader = createReader(socket);
  const greet = await reader.next();
  if (greet.code !== 220) throw new Error(`Mail server replied ${greet.code}`);
  if (starttls ?? !secure) {
    await command(socket, reader, "EHLO screenova", [250]);
    await command(socket, reader, "STARTTLS", [220]);
    socket.removeAllListeners("data");
    socket.removeAllListeners("error");
    socket = await connect({ host, socket });
    reader = createReader(socket);
  }
  await command(socket, reader, "EHLO screenova", [250]);
  await command(socket, reader, "AUTH LOGIN", [334]);
  await command(socket, reader, Buffer.from(user).toString("base64"), [334]);
  await command(socket, reader, Buffer.from(password).toString("base64"), [235]);
  await command(socket, reader, `MAIL FROM:<${from}>`, [250]);
  await command(socket, reader, `RCPT TO:<${to}>`, [250]);
  await command(socket, reader, "DATA", [354]);
  socket.write(`${data}\r\n.\r\n`);
  const queued = await reader.next();
  if (queued.code !== 250) throw new Error(`Mail server replied ${queued.code}`);
  socket.write("QUIT\r\n");
  socket.end();
}
