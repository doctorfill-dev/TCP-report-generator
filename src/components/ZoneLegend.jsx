import PropTypes from "prop-types";

export default function ZoneLegend({ ZCOL, zoneLabel, zones }) {
  const zoneList = zones?.length ? zones : ["Z1", "Z2", "Z3", "Z4", "Z5"];
  const items = zoneList.map((z) => ({ z, c: ZCOL[z] }));

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
  zones: PropTypes.arrayOf(PropTypes.string),
};
