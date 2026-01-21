import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { sendFormspree } from "../lib/formspree";

// Honeypot anti-bot (champ caché)
const BOT_FIELD = "company_website";

export default function FeedbackModal({ isOpen, onClose }) {
  const endpoint = import.meta.env.VITE_FORMSPREE_ENDPOINT;
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

  const captchaElRef = useRef(null);
  const widgetIdRef = useRef(null);

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [bot, setBot] = useState("");

  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  // On garde en mémoire une "action" à exécuter après obtention du token
  const pendingSubmitRef = useRef(false);

  const resetForm = () => {
    setEmail("");
    setMessage("");
    setBot("");
    setSuccess(false);
    setError(null);
    pendingSubmitRef.current = false;

    // reset captcha si dispo
    if (window.grecaptcha && widgetIdRef.current != null) {
      try {
        window.grecaptcha.reset(widgetIdRef.current);
      } catch {
        // ignore
      }
    }
  };

  // Render reCAPTCHA v2 Invisible quand le modal s’ouvre
  useEffect(() => {
    if (!isOpen) return;

    // Nettoyage d'état quand on ouvre
    setError(null);
    setSuccess(false);

    // Si pas de clés, on reste fonctionnel mais on affichera un message d’erreur à l’envoi
    if (!siteKey) return;

    const tryRender = () => {
      if (!window.grecaptcha) return false;
      if (!captchaElRef.current) return false;
      if (widgetIdRef.current != null) return true;

      widgetIdRef.current = window.grecaptcha.render(captchaElRef.current, {
        sitekey: siteKey,
        size: "invisible",
        callback: (token) => {
          // token prêt -> on envoie si un submit était en attente
          if (pendingSubmitRef.current) {
            pendingSubmitRef.current = false;
            void submitWithToken(token);
          }
        },
        "expired-callback": () => {
          setError("reCAPTCHA expiré. Réessayez.");
        },
        "error-callback": () => {
          setError("reCAPTCHA indisponible. Réessayez.");
        },
      });

      return true;
    };

    // attend le chargement du script google
    const t = setInterval(() => {
      if (tryRender()) clearInterval(t);
    }, 100);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, siteKey]);

  const validate = () => {
    const e = String(email || "").trim();
    const m = String(message || "").trim();

    if (!e) return "Email requis";
    // validation simple email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "Email invalide";
    if (!m) return "Message requis";
    if (m.length > 2000) return "Message trop long (max 2000 caractères)";
    return null;
  };

  const submitWithToken = async (token) => {
    if (!endpoint) {
      setError("VITE_FORMSPREE_ENDPOINT manquant (.env)");
      return;
    }

    setSending(true);
    setError(null);

    try {
      // ⚠️ On n’envoie QUE email + message (+ recaptcha)
      const payload = {
        email: String(email).trim(),
        message: String(message).trim().slice(0, 2000),
        "g-recaptcha-response": token,
      };

      await sendFormspree(payload, { endpoint });

      setSuccess(true);
      setTimeout(() => {
        resetForm();
        onClose();
      }, 1200);
    } catch (err) {
      console.error("Formspree error:", err);
      setError(err?.message || "Échec de l'envoi. Réessayez.");
      // reset captcha pour autoriser un nouvel essai
      if (window.grecaptcha && widgetIdRef.current != null) {
        try {
          window.grecaptcha.reset(widgetIdRef.current);
        } catch {
          // ignore
        }
      }
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = () => {
    setError(null);

    // Honeypot rempli => on "fait comme si" ok (anti-bot)
    if (bot && bot.trim() !== "") {
      setSuccess(true);
      setTimeout(() => {
        resetForm();
        onClose();
      }, 600);
      return;
    }

    const vErr = validate();
    if (vErr) {
      setError(vErr);
      return;
    }

    if (!siteKey) {
      setError("VITE_RECAPTCHA_SITE_KEY manquant (.env)");
      return;
    }

    if (!window.grecaptcha || widgetIdRef.current == null) {
      setError("reCAPTCHA non chargé. Vérifie le script dans index.html.");
      return;
    }

    // Déclenche le challenge invisible -> callback(token) => submitWithToken(token)
    pendingSubmitRef.current = true;
    try {
      window.grecaptcha.execute(widgetIdRef.current);
    } catch (e) {
      pendingSubmitRef.current = false;
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

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Votre email</label>
              <input
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
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full border rounded p-2 min-h-[120px]"
                placeholder="Votre message..."
                maxLength={2000}
              />
              <div className="text-xs text-gray-500 mt-1">{message.length}/2000</div>
            </div>

            {/* Honeypot caché */}
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

            {/* Conteneur reCAPTCHA invisible (obligatoire pour v2 Invisible) */}
            <div ref={captchaElRef} />

            {error && (
              <div className="mb-4 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleSubmit}
                disabled={sending}
                className={`flex-1 py-2 rounded font-medium transition-colors ${
                  sending ? "bg-gray-300 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
                type="button"
              >
                {sending ? "⏳ Envoi..." : "Envoyer"}
              </button>

              <button
                onClick={() => {
                  resetForm();
                  onClose();
                }}
                disabled={sending}
                className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
                type="button"
              >
                Annuler
              </button>
            </div>

            {(!endpoint || !siteKey) && (
              <p className="mt-3 text-xs text-red-600">
                ⚠️ Vérifie `.env` : VITE_FORMSPREE_ENDPOINT et VITE_RECAPTCHA_SITE_KEY
              </p>
            )}
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