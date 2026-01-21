import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { sendFormspree } from "../lib/formspree";

const BOT_FIELD = "company_website";

export default function FeedbackModal({ isOpen, onClose }) {
  const endpoint = import.meta.env.VITE_FORMSPREE_ENDPOINT;
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

  const formRef = useRef(null);
  const captchaElRef = useRef(null);
  const widgetIdRef = useRef(null);

  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [bot, setBot] = useState("");

  // render reCAPTCHA v2 invisible
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSuccess(false);

    if (!siteKey) return;

    const tryRender = () => {
      if (!window.grecaptcha || !captchaElRef.current) return false;
      if (widgetIdRef.current != null) return true;

      widgetIdRef.current = window.grecaptcha.render(captchaElRef.current, {
        sitekey: siteKey,
        size: "invisible",
        callback: (token) => {
          void submitWithToken(token);
        },
        "expired-callback": () => setError("reCAPTCHA expiré. Réessayez."),
        "error-callback": () => setError("reCAPTCHA indisponible. Réessayez."),
      });

      return true;
    };

    const t = setInterval(() => {
      if (tryRender()) clearInterval(t);
    }, 100);

    return () => clearInterval(t);
  }, [isOpen, siteKey]);

  const validate = () => {
    const e = String(email || "").trim();
    const m = String(message || "").trim();
    if (!e) return "Email requis";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "Email invalide";
    if (!m) return "Message requis";
    if (m.length > 2000) return "Message trop long (max 2000 caractères)";
    return null;
  };

  const resetForm = () => {
    setEmail("");
    setMessage("");
    setBot("");
    setError(null);
    setSuccess(false);

    if (window.grecaptcha && widgetIdRef.current != null) {
      try { window.grecaptcha.reset(widgetIdRef.current); } catch {}
    }
  };

  const submitWithToken = async (token) => {
    if (!endpoint) return setError("VITE_FORMSPREE_ENDPOINT manquant (.env)");
    if (!formRef.current) return setError("Formulaire introuvable");

    setSending(true);
    setError(null);

    try {
      // FormData depuis un vrai <form> => Formspree récupère correctement email/message
      const fd = new FormData();
      fd.set("email", String(email).trim());
      fd.set("message", String(message).trim().slice(0, 2000));
      fd.set("g-recaptcha-response", token);

      fd.append("company_website", String(bot || ""));

      console.log("FormData:", Object.fromEntries(fd.entries()));
      await sendFormspree(fd, { endpoint });

      setSuccess(true);
      setTimeout(() => {
        resetForm();
        onClose();
      }, 1200);
    } catch (err) {
      setError(err?.message || "Échec de l'envoi. Réessayez.");
      if (window.grecaptcha && widgetIdRef.current != null) {
        try { window.grecaptcha.reset(widgetIdRef.current); } catch {}
      }
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    setError(null);

    // honeypot
    if (bot && bot.trim() !== "") {
      setSuccess(true);
      setTimeout(() => {
        resetForm();
        onClose();
      }, 600);
      return;
    }

    const vErr = validate();
    if (vErr) return setError(vErr);

    if (!siteKey) return setError("VITE_RECAPTCHA_SITE_KEY manquant (.env)");
    if (!window.grecaptcha || widgetIdRef.current == null) {
      return setError("reCAPTCHA non chargé. Vérifie le script dans index.html.");
    }

    try {
      window.grecaptcha.execute(widgetIdRef.current);
    } catch {
      setError("Impossible d'exécuter reCAPTCHA. Réessayez.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 no-print">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        {success ? (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">✅</div>
            <h3 className="text-xl font-bold text-green-600 mb-2">Message envoyé</h3>
            <p className="text-gray-600">Merci !</p>
          </div>
        ) : (
          <>
            <h3 className="text-xl font-bold mb-4">Nous contacter</h3>

            <form ref={formRef} onSubmit={onSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Votre email</label>
                <input
                  id="email"
                  name="email"              // ✅ IMPORTANT
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border rounded p-2"
                  placeholder="votre@email.com"
                  autoComplete="email"
                  maxLength={254}
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Votre message</label>
                <textarea
                  id="message"
                  name="message"            // ✅ IMPORTANT
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full border rounded p-2 min-h-[120px]"
                  placeholder="Votre message..."
                  maxLength={2000}
                />
                <div className="text-xs text-gray-500 mt-1">{message.length}/2000</div>
              </div>

              <div className="hidden" aria-hidden="true">
                <label>Website</label>
                <input
                  name={BOT_FIELD}
                  value={bot}
                  onChange={(e) => setBot(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              {/* conteneur reCAPTCHA */}
              <div ref={captchaElRef} />

              {error && (
                <div className="mb-4 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={sending}
                  className={`flex-1 py-2 rounded font-medium transition-colors ${
                    sending ? "bg-gray-300 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {sending ? "⏳ Envoi..." : "Envoyer"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    onClose();
                  }}
                  disabled={sending}
                  className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Annuler
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

FeedbackModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};