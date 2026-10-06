// =====================================================================
// /api/data — lit et écrit les données du projet dans Vercel Blob, pour
// que les modifications faites dans l'onglet "Édition" soient partagées
// entre toutes les personnes qui ouvrent le site (pas juste dans le
// navigateur de la personne qui édite).
//
// Configuration requise côté Vercel (une seule fois, voir README.md) :
//   1. Dashboard du projet → Storage → Create Database → Blob → Connect.
//      Cela crée automatiquement la variable d'environnement
//      BLOB_READ_WRITE_TOKEN.
//   2. (Recommandé) Ajouter une variable d'environnement EDIT_PASSWORD
//      pour protéger l'écriture (sinon n'importe qui connaissant l'URL
//      du site peut modifier les données).
//   3. Redéployer.
//
// Sans Blob configuré : GET renvoie les données par défaut packagées
// avec le site (data.json) ; POST échoue proprement avec un message
// clair, et le site continue de fonctionner en mode "édition locale
// uniquement" (localStorage) grâce au fallback côté app.js.
// =====================================================================

import { put, list } from "@vercel/blob";

const BLOB_PATHNAME = "pilotage-data.json";
// Sans données Blob, GET répond 404 et le site charge data.json (fichier statique).

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Edit-Password");
  if (req.method === "OPTIONS") return res.status(204).end();

  const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

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
      const r = await fetch(blobs[0].url, { cache: "no-store" });
      if (!r.ok) throw new Error("blob fetch failed: " + r.status);
      const json = await r.json();
      return res.status(200).json(json);
    } catch (e) {
      console.error("GET /api/data error", e);
      return res.status(404).json({ error: "blob_unavailable" });
    }
  }

  if (req.method === "POST") {
    if (!hasBlob) {
      return res.status(503).json({
        error: "no_blob_configured",
        message: "Le stockage partagé (Vercel Blob) n'est pas configuré sur ce projet. Voir README.md, section 6.",
      });
    }
    const expected = process.env.EDIT_PASSWORD;
    if (expected) {
      const given = req.headers["x-edit-password"];
      if (given !== expected) {
        return res.status(401).json({ error: "unauthorized", message: "Mot de passe d'édition incorrect." });
      }
    }
    try {
      const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
      if (!body || !Array.isArray(body.centers)) {
        return res.status(400).json({ error: "invalid_payload", message: "Le format des données envoyées est invalide." });
      }
      await put(BLOB_PATHNAME, JSON.stringify(body), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("POST /api/data error", e);
      return res.status(500).json({ error: "save_failed", message: String(e.message || e) });
    }
  }

  return res.status(405).json({ error: "method_not_allowed" });
}
