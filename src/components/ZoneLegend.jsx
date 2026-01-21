import PropTypes from "prop-types";

export default function ZoneLegend({ ZCOL, zoneLabel }) {
  const items = [
    { z: "Z1", c: ZCOL.Z1 },
    { z: "Z2", c: ZCOL.Z2 },
    { z: "Z3", c: ZCOL.Z3 },
    { z: "Z4", c: ZCOL.Z4 },
    { z: "Z5", c: ZCOL.Z5 },
  ];

  return (
    <div className="legend-row" role="list" aria-label="Légende des zones d'entraînement">
      {items.map((it) => (
        <span key={it.z} className="legend-item" role="listitem">
          <span className="dot" style={{ background: it.c }} aria-hidden="true" />
          <span className="font-semibold">{it.z}</span>
          <span className="opacity-80">{zoneLabel(it.z)}</span>
        </span>
      ))}
    </div>
  );
}

ZoneLegend.propTypes = {
  ZCOL: PropTypes.object.isRequired,
  zoneLabel: PropTypes.func.isRequired,
};
