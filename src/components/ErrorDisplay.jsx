import PropTypes from "prop-types";

export default function ErrorDisplay({ error, onDismiss }) {
  if (!error) return null;

  const isValidation = error?.name === "ValidationError";

  return (
    <div className={isValidation ? "error-banner" : "warning-banner"} role="alert">
      <div className="flex justify-between items-start">
        <div>
          <strong className="block text-base mb-1">
            {isValidation ? "❌ Erreur de validation" : "⚠️ Erreur"}
          </strong>
          <p className="text-sm">{error.message}</p>
          {isValidation && error.details?.length > 0 && (
            <ul className="mt-2 text-sm list-disc list-inside space-y-1">
              {error.details.map((detail, i) => (
                <li key={i}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="ml-4 text-xl hover:opacity-70"
          aria-label="Fermer l'erreur"
        >
          ×
        </button>
      </div>
    </div>
  );
}

ErrorDisplay.propTypes = {
  error: PropTypes.any,
  onDismiss: PropTypes.func.isRequired,
};
