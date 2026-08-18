/* Guard 39: WebSocket transport.
 * Minimal RFC 6455 server — handshake + text frames only, no dependencies.
 * Content delivered over a WS never appears in any HTML response, so scrapers
 * built on "fetch the page, parse the DOM" get nothing. */
"use strict";
const crypto = require("crypto");

// RFC 6455 magic GUID. Verified against the spec's test vector:
//   accept("dGhlIHNhbXBsZSBub25jZQ==") === "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function accept(key) {
  return crypto.createHash("sha1").update(key + GUID).digest("base64");
}

/* Encode a single unfragmented text frame (server->client frames are unmasked). */
function encodeTextFrame(str) {
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/* Decode client->server frames (always masked). Returns [{opcode, text}]. */
function decodeFrames(buf) {
  const out = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const opcode = buf[off] & 0x0f;
    const masked = (buf[off + 1] & 0x80) !== 0;
    let len = buf[off + 1] & 0x7f;
    let pos = off + 2;
    if (len === 126) { len = buf.readUInt16BE(pos); pos += 2; }
    else if (len === 127) { len = Number(buf.readBigUInt64BE(pos)); pos += 8; }
    let mask = null;
    if (masked) { mask = buf.slice(pos, pos + 4); pos += 4; }
    if (pos + len > buf.length) break;
    const data = buf.slice(pos, pos + len);
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    out.push({ opcode, text: data.toString("utf8") });
    off = pos + len;
  }
  return out;
}

/* Wire the upgrade handler onto an http.Server. */
function attach(server, { path = "/ws", onMessage } = {}) {
  server.on("upgrade", (req, socket) => {
    if (new URL(req.url, "http://x").pathname !== path) { socket.destroy(); return; }
    const key = req.headers["sec-websocket-key"];
    if (!key) { socket.destroy(); return; }

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept(key)}\r\n\r\n`
    );

    const send = (str) => socket.write(encodeTextFrame(str));
    socket.on("data", (chunk) => {
      for (const frame of decodeFrames(chunk)) {
        if (frame.opcode === 0x8) { socket.end(); return; } // close
        if (frame.opcode === 0x1 && onMessage) onMessage(frame.text, send);
      }
    });
    socket.on("error", () => socket.destroy());
  });
}

module.exports = { attach, encodeTextFrame, decodeFrames, accept };
