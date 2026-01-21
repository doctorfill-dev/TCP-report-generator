export async function sendFormspree(formData, { endpoint }) {
  if (!endpoint)
    throw new Error("Formspree endpoint manquant (VITE_FORMSPREE_ENDPOINT)");

  const res = await fetch(endpoint, {
    method: "POST",
    mode: "cors",
    headers: {
      Accept: "application/json",
    },
    body: formData, // ⚠️ pas de Content-Type
  });

  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  if (!res.ok) {
    const msg =
      data?.errors?.[0]?.message || data?.error || `Erreur HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
