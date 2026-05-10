import net from "net";
import tls from "tls";

function encodeBase64(value) {
  return Buffer.from(value).toString("base64");
}

function escapeHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function waitLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3} /.test(last)) {
        socket.off("data", onData);
        resolve(buffer);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function command(socket, text, expected) {
  socket.write(`${text}\r\n`);
  const response = await waitLine(socket);
  const code = Number(response.slice(0, 3));
  if (!expected.includes(code)) throw new Error(`SMTP command failed: ${response.trim()}`);
}

function attachmentPart(attachment, index) {
  const boundaryHeader = [];
  const filename = escapeHeader(attachment.filename || `attachment-${index + 1}`);
  const contentType = escapeHeader(attachment.contentType || "application/octet-stream");
  const content = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(String(attachment.content || ""));
  const encoded = content.toString("base64").replace(/(.{76})/g, "$1\r\n");
  boundaryHeader.push(`Content-Type: ${contentType}; name="${filename}"`);
  boundaryHeader.push("Content-Transfer-Encoding: base64");
  boundaryHeader.push(`Content-Disposition: attachment; filename="${filename}"`);
  boundaryHeader.push("");
  boundaryHeader.push(encoded);
  return boundaryHeader.join("\r\n");
}

export async function sendEmail({ smtp, to, subject, text, attachments = [] }) {
  if (!smtp?.host || !smtp?.fromEmail || !to) {
    return { skipped: true, reason: "SMTP host, from email, or recipient email is missing" };
  }

  const port = Number(smtp.port || (smtp.secure ? 465 : 587));
  let socket = smtp.secure
    ? tls.connect(port, smtp.host, { servername: smtp.host })
    : net.connect(port, smtp.host);

  await waitLine(socket);
  await command(socket, `EHLO ${smtp.host}`, [250]);

  if (!smtp.secure) {
    await command(socket, "STARTTLS", [220]);
    socket = tls.connect({ socket, servername: smtp.host });
    await command(socket, `EHLO ${smtp.host}`, [250]);
  }

  if (smtp.user && smtp.pass) {
    await command(socket, "AUTH LOGIN", [334]);
    await command(socket, encodeBase64(smtp.user), [334]);
    await command(socket, encodeBase64(smtp.pass), [235]);
  }

  const fromLabel = smtp.fromName ? `"${escapeHeader(smtp.fromName)}" <${smtp.fromEmail}>` : smtp.fromEmail;
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const boundary = `krita-boundary-${Date.now()}`;
  const message = hasAttachments
    ? [
        `From: ${fromLabel}`,
        `To: ${escapeHeader(to)}`,
        `Subject: ${escapeHeader(subject)}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 7bit",
        "",
        text,
        ...attachments.flatMap((attachment, index) => ["", `--${boundary}`, attachmentPart(attachment, index)]),
        "",
        `--${boundary}--`,
      ].join("\r\n")
    : [
        `From: ${fromLabel}`,
        `To: ${escapeHeader(to)}`,
        `Subject: ${escapeHeader(subject)}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        text,
      ].join("\r\n");

  await command(socket, `MAIL FROM:<${smtp.fromEmail}>`, [250]);
  await command(socket, `RCPT TO:<${to}>`, [250, 251]);
  await command(socket, "DATA", [354]);
  await command(socket, `${message}\r\n.`, [250]);
  await command(socket, "QUIT", [221]);
  socket.end();

  return { skipped: false };
}
