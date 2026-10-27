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

// Adresse publique du stockage, déduite de l'identifiant (évite l'appel « list », comptabilisé comme opération avancée).
function storeHost() {
  let id = process.env.BLOB_STORE_ID || "";
  if (!id && process.env.BLOB_READ_WRITE_TOKEN) id = "store_" + (process.env.BLOB_READ_WRITE_TOKEN.split("_")[3] || "");
  return id.startsWith("store_") && id.length > 6 ? `https://${id.slice(6).toLowerCase()}.public.blob.vercel-storage.com` : null;
}

// Lecture sans « list » : 1 seule requête simple quand le stockage est public.
async function readData() {
  const host = storeHost();
  if (host) {
    try {
      const r = await fetch(`${host}/${BLOB_PATHNAME}?t=${Date.now()}`, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch (e) { /* essai suivant */ }
  }
  try {
    const res = await get(BLOB_PATHNAME, { access: "private", useCache: false });
    if (res) return JSON.parse(await new Response(res.stream).text());
  } catch (e) { /* essai suivant */ }
  const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });   // dernier recours (stockage vide ?)
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url + "?t=" + Date.now(), { cache: "no-store" });
  // Le fichier existe mais n'est pas lisible : on signale une erreur (surtout pas « vide »), pour ne jamais remplacer de vraies données par les données de départ.
  if (!r.ok) throw new Error("fichier de données présent mais illisible (HTTP " + r.status + ")");
  return await r.json();
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
      const data = await readData();
      if (!data) {
        // Blob configuré mais encore vide : on sert les données de départ (data.json statique)
        const proto = req.headers["x-forwarded-proto"] || "https";
        const seed = await fetch(`${proto}://${req.headers.host}/data.json`, { cache: "no-store" });
        if (!seed.ok) throw new Error("seed fetch failed: " + seed.status);
        return res.status(200).json(await seed.json());
      }
      return res.status(200).json(data);
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
