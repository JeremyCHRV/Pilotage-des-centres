// /api/files — dépôt, lecture et suppression des documents et photos de chaque centre (Vercel Blob).
//   POST   /api/files?centre=ID&name=NOM   (corps = fichier brut, Content-Type: application/octet-stream)
//   GET    /api/files?p=files/...          (renvoie le fichier)
//   DELETE /api/files?p=files/...
// Limite Vercel pour le corps d'une requête : 4,5 Mo (les photos sont réduites par le navigateur avant l'envoi).
import { put, list, get, del } from "@vercel/blob";

const MAX_BYTES = 4.2 * 1024 * 1024;
const MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic",
  pdf: "application/pdf", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const extOf = (n) => (String(n).split(".").pop() || "").toLowerCase();
const safe = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "fichier";

async function putFile(path, buf, contentType) {
  const opts = { addRandomSuffix: true, contentType };
  try {
    return await put(path, buf, { ...opts, access: "public" });
  } catch (e) {
    if (/private/i.test(String((e && e.message) || e))) return await put(path, buf, { ...opts, access: "private" });
    throw e;
  }
}

async function readFile(pathname) {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  if (!blobs.length) return null;
  try {
    const r = await fetch(blobs[0].url);
    if (r.ok) return Buffer.from(await r.arrayBuffer());
  } catch (e) { /* lecture privée ci-dessous */ }
  const res = await get(blobs[0].pathname, { access: "private", useCache: false });
  if (!res) return null;
  return Buffer.from(await new Response(res.stream).arrayBuffer());
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Edit-Password");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)) {
    return res.status(503).json({ error: "no_blob_configured", message: "Le stockage partagé (Vercel Blob) n'est pas configuré." });
  }
  const url = new URL(req.url, "http://x");
  const expected = process.env.EDIT_PASSWORD;
  const needAuth = req.method !== "GET";
  if (needAuth && expected && req.headers["x-edit-password"] !== expected) {
    return res.status(401).json({ error: "unauthorized", message: "Mot de passe d'édition incorrect." });
  }

  try {
    if (req.method === "POST") {
      const name = url.searchParams.get("name") || "fichier";
      const centre = safe(url.searchParams.get("centre") || "centre");
      const ext = extOf(name);
      if (!MIME[ext]) return res.status(415).json({ error: "type", message: "Type de fichier non autorisé (images, PDF, Word, Excel, PowerPoint, texte, CSV)." });
      const buf = await readBody(req);
      if (!buf.length) return res.status(400).json({ error: "empty", message: "Fichier vide." });
      if (buf.length > MAX_BYTES) return res.status(413).json({ error: "size", message: "Fichier trop volumineux (maximum 4 Mo)." });
      const r = await putFile(`files/${centre}/${safe(name)}`, buf, MIME[ext]);
      return res.status(200).json({ ok: true, path: r.pathname, size: buf.length });
    }

    const p = url.searchParams.get("p") || "";
    if (!p.startsWith("files/") || p.includes("..")) return res.status(400).json({ error: "bad_path" });

    if (req.method === "GET") {
      const buf = await readFile(p);
      if (!buf) return res.status(404).json({ error: "not_found" });
      const ext = extOf(p);
      const ct = MIME[ext] || "application/octet-stream";
      const dl = url.searchParams.get("dl") === "1";
      const fname = safe(url.searchParams.get("name") || p.split("/").pop());
      res.setHeader("Content-Type", ct);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `${dl || !/^(image\/|application\/pdf)/.test(ct) ? "attachment" : "inline"}; filename="${fname}"`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      return res.status(200).send(buf);
    }

    if (req.method === "DELETE") {
      const { blobs } = await list({ prefix: p, limit: 1 });
      if (blobs.length) await del(blobs[0].url);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    console.error("/api/files error", e);
    return res.status(500).json({ error: "failed", message: String((e && e.message) || e) });
  }
}
