/**
 * Correctifs Formspree (JSON):
 * - Content-Type: application/json
 * - Accept: application/json (sinon Formspree peut répondre en HTML)
 * - gestion d'erreurs JSON
 *
 * ⚠️ Remarque: si tu testes depuis file://, le navigateur peut bloquer.
 * Utilise `npm run dev` ou un serveur HTTP.
 */
export async function sendFormspree(payload, { endpoint }) {
  if (!endpoint) throw new Error("Formspree endpoint manquant (VITE_FORMSPREE_ENDPOINT)");

  const res = await fetch(endpoint, {
    method: "POST",
    mode: "cors",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(payload),
  });

  // Formspree renvoie souvent { ok, errors: [...] }
  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    // fallback (évite de faire planter l'app si réponse HTML)
    const txt = await res.text().catch(() => "");
    data = { raw: txt };
  }

  if (!res.ok) {
    const msg =
      data?.errors?.[0]?.message ||
      data?.error ||
      `Erreur HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}
