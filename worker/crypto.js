/** Cryptographic helpers for the Yahoo connection. Keys are 32-byte base64url secrets. */

const encoder = new TextEncoder();

export function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function unbase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid key encoding");
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(value) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function hmacKey(secret) {
  const bytes = unbase64url(secret);
  if (bytes.length !== 32) throw new Error("invalid cookie key");
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signHandle(id, secret) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(id));
  return `${id}.${base64url(new Uint8Array(signature))}`;
}

export async function verifyHandle(value, secret) {
  const match = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  if (!match) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), unbase64url(match[2]), encoder.encode(match[1]));
  } catch { return null; }
  return valid ? match[1] : null;
}

async function aesKey(secret) {
  const bytes = unbase64url(secret);
  if (bytes.length !== 32) throw new Error("invalid token key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(value, secret, sessionId) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(sessionId) }, await aesKey(secret), encoder.encode(JSON.stringify(value)));
  return { version: 1, iv: base64url(iv), ciphertext: base64url(new Uint8Array(encrypted)) };
}

export async function open(sealed, secret, sessionId) {
  if (sealed?.version !== 1) throw new Error("unsupported token envelope");
  const decoded = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64url(sealed.iv), additionalData: encoder.encode(sessionId) }, await aesKey(secret), unbase64url(sealed.ciphertext));
  return JSON.parse(new TextDecoder().decode(decoded));
}
