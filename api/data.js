// /api/data — lit et écrit les données du projet dans Vercel Blob (partagé entre toutes les personnes).
// Authentification : BLOB_READ_WRITE_TOKEN (ancien mode) OU BLOB_STORE_ID + OIDC (nouveau mode, automatique sur Vercel).
// Sans Blob configuré : GET répond 404 et le site charge data.json (statique) ; POST répond 503.
import { put, list, get } from "@vercel/blob";

const BLOB_PATHNAME = "pilotage-data.json";

async function putJson(body) {
  const opts = { addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" };
  try {
    return await put(BLOB_PATHNAME, body, { ...opts, access: "public" });
  } catch (e) {
    if (/private/i.test(String((e && e.message) || e))) {
      return await put(BLOB_PATHNAME, body, { ...opts, access: "private" });
    }
    throw e;
  }
}

async function readJson(blob) {
  try {
    const r = await fetch(blob.url + "?t=" + Date.now(), { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (e) { /* on tente la lecture privée ci-dessous */ }
  const res = await get(blob.pathname, { access: "private", useCache: false });
  if (!res) throw new Error("blob introuvable");
  return JSON.parse(await new Response(res.stream).text());
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Edit-Password");
  if (req.method === "OPTIONS") return res.status(204).end();

  const hasBlob = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

  if (req.method === "GET") {
    if (!hasBlob) return res.status(404).json({ error: "no_blob" });
    try {
      const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
      if (!blobs.length) {
        // Blob configuré mais encore vide : on sert les données de départ (data.json statique)
        const proto = req.headers["x-forwarded-proto"] || "https";
        const seed = await fetch(`${proto}://${req.headers.host}/data.json`, { cache: "no-store" });
        if (!seed.ok) throw new Error("seed fetch failed: " + seed.status);
        return res.status(200).json(await seed.json());
      }
      return res.status(200).json(await readJson(blobs[0]));
    } catch (e) {
      console.error("GET /api/data error", e);
      return res.status(404).json({ error: "blob_unavailable", detail: String((e && e.message) || e) });
    }
  }

  if (req.method === "POST") {
    if (!hasBlob) {
      return res.status(503).json({
        error: "no_blob_configured",
        message: "Le stockage partagé (Vercel Blob) n'est pas configuré sur ce projet.",
      });
    }
    const expected = process.env.EDIT_PASSWORD;
    if (expected && req.headers["x-edit-password"] !== expected) {
      return res.status(401).json({ error: "unauthorized", message: "Mot de passe d'édition incorrect." });
    }
    try {
      const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
      if (!body || !Array.isArray(body.centers)) {
        return res.status(400).json({ error: "invalid_payload", message: "Format invalide." });
      }
      await putJson(JSON.stringify(body));
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("POST /api/data error", e);
      return res.status(500).json({ error: "save_failed", message: String(e.message || e) });
    }
  }

  return res.status(405).json({ error: "method_not_allowed" });
}
