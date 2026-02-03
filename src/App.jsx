import { useCallback, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import html2canvas from "html2canvas";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  PageBreak,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import FeedbackModal from "./components/FeedbackModal.jsx";
import ErrorDisplay from "./components/ErrorDisplay.jsx";
import ZoneLegend from "./components/ZoneLegend.jsx";

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
  MAX_DATA_POINTS: 10000,
  MAX_FILE_SIZE_MB: 50,
  CHART_CAPTURE_TIMEOUT: 15000,
  CHART_CAPTURE_RETRIES: 2,
  MIN_MEASUREMENTS: 10,
  VALIDATION: {
    FC_MIN: 30,
    FC_MAX: 250,
    VITESSE_MIN: 0,
    VITESSE_MAX: 30,
    POWER_MIN: 0,
    POWER_MAX: 500,
    VO2_MIN: 0,
    VO2_MAX: 10,
  },
};

// ==========================================
// UTILITAIRES DE VALIDATION
// ==========================================
class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

const validateNumber = (value, min, max, fieldName) => {
  const num = parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(num)) {
    throw new ValidationError(`${fieldName} invalide: "${value}"`);
  }
  if (num < min || num > max) {
    throw new ValidationError(`${fieldName} hors limites (${min}-${max}): ${num}`);
  }
  return num;
};

const safeNum = (value, defaultValue = 0) => {
  const num = parseFloat(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : defaultValue;
};

const validateRequiredString = (value, fieldName) => {
  if (!value || String(value).trim() === "") {
    throw new ValidationError(`${fieldName} requis mais vide`);
  }
  return String(value).trim();
};

// ==========================================
// VALIDATION DES DONNÉES
// ==========================================
const validateParsedData = (data) => {
  const errors = [];

  try { validateRequiredString(data.patient.nom, "Nom du patient"); } catch (e) { errors.push(e.message); }
  try { validateRequiredString(data.patient.prenom, "Prénom du patient"); } catch (e) { errors.push(e.message); }

  try { validateNumber(data.vt1.fc, CONFIG.VALIDATION.FC_MIN, CONFIG.VALIDATION.FC_MAX, "V1 FC"); } catch (e) { errors.push(e.message); }

  // Validate speed OR power depending on test type
  const isBike = data.testType === "bike";
  if (isBike) {
    try { validateNumber(data.vt1.power, CONFIG.VALIDATION.POWER_MIN, CONFIG.VALIDATION.POWER_MAX, "V1 Puissance"); } catch (e) { errors.push(e.message); }
  } else {
    try { validateNumber(data.vt1.vitesse, CONFIG.VALIDATION.VITESSE_MIN, CONFIG.VALIDATION.VITESSE_MAX, "V1 Vitesse"); } catch (e) { errors.push(e.message); }
  }

  try {
    const fc2 = validateNumber(data.vt2.fc, CONFIG.VALIDATION.FC_MIN, CONFIG.VALIDATION.FC_MAX, "V2 FC");
    const fc1 = safeNum(data.vt1.fc);
    if (fc2 <= fc1) errors.push(`V2 FC (${fc2}) doit être > V1 FC (${fc1})`);
  } catch (e) { errors.push(e.message); }

  if (isBike) {
    try {
      const p2 = validateNumber(data.vt2.power, CONFIG.VALIDATION.POWER_MIN, CONFIG.VALIDATION.POWER_MAX, "V2 Puissance");
      const p1 = safeNum(data.vt1.power);
      if (p2 <= p1) errors.push(`V2 Puissance (${p2}) doit être > V1 Puissance (${p1})`);
    } catch (e) { errors.push(e.message); }
  } else {
    try {
      const v2 = validateNumber(data.vt2.vitesse, CONFIG.VALIDATION.VITESSE_MIN, CONFIG.VALIDATION.VITESSE_MAX, "V2 Vitesse");
      const v1 = safeNum(data.vt1.vitesse);
      if (v2 <= v1) errors.push(`V2 Vitesse (${v2}) doit être > V1 Vitesse (${v1})`);
    } catch (e) { errors.push(e.message); }
  }

  try { validateNumber(data.peakVO2.vo2, CONFIG.VALIDATION.VO2_MIN, CONFIG.VALIDATION.VO2_MAX, "VO2 Peak"); } catch (e) { errors.push(e.message); }
  try { validateNumber(data.peakVO2.vo2kg, 0, 100, "VO2 Peak/kg"); } catch (e) { errors.push(e.message); }

  if (!Array.isArray(data.measurements) || data.measurements.length < CONFIG.MIN_MEASUREMENTS) {
    errors.push(`Insuffisant de mesures: ${data.measurements?.length || 0} (minimum: ${CONFIG.MIN_MEASUREMENTS})`);
  }

  if (Array.isArray(data.measurements) && data.measurements.length > CONFIG.MAX_DATA_POINTS) {
    errors.push(`Trop de mesures: ${data.measurements.length} (maximum: ${CONFIG.MAX_DATA_POINTS})`);
  }

  if (errors.length > 0) throw new ValidationError("Validation échouée", errors);
  return true;
};

// ==========================================
// PARSING XML SÉCURISÉ
// ==========================================
const parseXMLSafe = (xmlString) => {
  if (!xmlString || typeof xmlString !== "string") {
    throw new ValidationError("Contenu XML invalide ou vide");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");

  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new ValidationError("XML mal formé: " + parserError.textContent);
  }

  const data = { patient: {}, test: {}, vt1: {}, vt2: {}, peakVO2: {}, measurements: [], testType: "run" };

  let section = "", headers = [], inMeas = false;
  let hasSpeedData = false;
  let hasPowerData = false;

  try {
    Array.from(doc.getElementsByTagName("Row")).forEach((row) => {
      const cells = row.getElementsByTagName("Cell");
      if (!cells.length) return;

      const vals = [];
      let col = 0;

      Array.from(cells).forEach((cell) => {
        const d = cell.getElementsByTagName("Data")[0];
        const idx = cell.getAttribute("ss:Index");
        if (idx) col = parseInt(idx) - 1;
        vals[col] = d ? d.textContent : "";
        const merge = cell.getAttribute("ss:MergeAcross");
        if (merge) col += parseInt(merge);
        col++;
      });

      const first = vals[0] || "";
      if (first === "Données du patient") { section = "patient"; return; }
      if (first === "Données test") { section = "test"; return; }
      if (first === "Tableau Résumé") { section = "summary"; return; }
      if (first === "Measurement Data") { section = "meas"; inMeas = true; return; }

      const v = vals[2] || vals[1] || "";

      if (section === "patient") {
        if (first === "Nom") data.patient.nom = v;
        if (first === "Prénom") data.patient.prenom = v;
        if (first === "Date de Naissance") data.patient.dateNaissance = v;
        if (first === "Sexe") data.patient.sexe = v;
        if (first === "Poids") data.patient.poids = v;
      }

      if (section === "test") {
        if (first === "Heure de début") data.test.dateHeure = v;
      }

      if (section === "summary" && first !== "Variable") {
        if (first === "V'O2") {
          data.vt1.vo2 = vals[5];
          data.vt2.vo2 = vals[8];
          data.peakVO2.vo2 = vals[11];
        }
        if (first === "V'O2/kg") {
          data.vt1.vo2kg = vals[5];
          data.vt2.vo2kg = vals[8];
          data.peakVO2.vo2kg = vals[11];
        }
        if (first === "FC") {
          data.vt1.fc = vals[5];
          data.vt2.fc = vals[8];
          data.peakVO2.fc = vals[11];
        }
        if (first === "v") {
          data.vt1.vitesse = vals[5];
          data.vt2.vitesse = vals[8];
          data.peakVO2.vitesse = vals[11];
          hasSpeedData = true;
        }
        if (first === "TT") {
          data.vt1.power = vals[5];
          data.vt2.power = vals[8];
          data.peakVO2.power = vals[11];
          hasPowerData = true;
        }
        if (first === "V'E") {
          data.vt1.ve = vals[5];
          data.vt2.ve = vals[8];
          data.peakVO2.ve = vals[11];
        }
      }

      if (inMeas && section === "meas") {
        if (first === "t") { headers = [...vals]; return; }
        if (first === "h:mm:ss,ms") return;
        if (first?.includes(":")) {
          const m = {};
          headers.forEach((h, i) => (m[h] = vals[i] || ""));

          const tp = first.split(":");
          const sp = tp[2]?.split(",") || ["0", "0"];
          m.timeSeconds =
            (parseInt(tp[0]) || 0) * 3600 +
            (parseInt(tp[1]) || 0) * 60 +
            (parseInt(sp[0]) || 0) +
            (parseInt(sp[1]) || 0) / 1000;

          m.vo2 = safeNum(m["V'O2"]);
          m.fc = safeNum(m["FC"]);
          m.ve = safeNum(m["V'E"]);
          m.phase = m["Phase"] || "";

          data.measurements.push(m);
        }
      }
    });
  } catch (e) {
    throw new ValidationError("Erreur lors du parsing XML: " + e.message);
  }

  // Fallback: extract power from measurements if not in Summary table
  // This handles XML files where TT (power) row is missing from Summary but present in MeasurementData
  if (!hasPowerData && data.measurements.length > 0) {
    const hasTTInMeasurements = data.measurements.some(m => m["TT"] !== undefined && m["TT"] !== "");

    if (hasTTInMeasurements && data.vt1.fc && data.vt2.fc && data.peakVO2.fc) {
      const fc1Target = safeNum(data.vt1.fc);
      const fc2Target = safeNum(data.vt2.fc);
      const fcPeakTarget = safeNum(data.peakVO2.fc);

      // Find measurements closest to VT1, VT2, and Peak FC values
      let vt1Match = null, vt2Match = null, peakMatch = null;
      let vt1Diff = Infinity, vt2Diff = Infinity, peakDiff = Infinity;

      data.measurements.forEach(m => {
        const fc = safeNum(m["FC"]);
        const power = safeNum(m["TT"]);
        if (power <= 0) return; // Skip measurements with no power

        // Match VT1 (lower FC)
        if (Math.abs(fc - fc1Target) < vt1Diff && fc <= fc1Target + 5) {
          vt1Diff = Math.abs(fc - fc1Target);
          vt1Match = m;
        }
        // Match VT2 (middle FC)
        if (Math.abs(fc - fc2Target) < vt2Diff && fc >= fc1Target && fc <= fc2Target + 5) {
          vt2Diff = Math.abs(fc - fc2Target);
          vt2Match = m;
        }
        // Match Peak (highest FC)
        if (Math.abs(fc - fcPeakTarget) < peakDiff) {
          peakDiff = Math.abs(fc - fcPeakTarget);
          peakMatch = m;
        }
      });

      if (vt1Match) data.vt1.power = String(safeNum(vt1Match["TT"]));
      if (vt2Match) data.vt2.power = String(safeNum(vt2Match["TT"]));
      if (peakMatch) data.peakVO2.power = String(safeNum(peakMatch["TT"]));

      // Mark as having power data if we found matches
      if (vt1Match && vt2Match) {
        hasPowerData = true;
      }
    }
  }

  // Detect test type based on available data
  if (hasPowerData && !hasSpeedData) {
    data.testType = "bike";
  } else if (hasSpeedData && !hasPowerData) {
    data.testType = "run";
  } else if (hasPowerData && hasSpeedData) {
    // Both present - use power if speed values are zero or invalid
    const hasValidSpeed = safeNum(data.vt1.vitesse) > 0 || safeNum(data.vt2.vitesse) > 0;
    data.testType = hasValidSpeed ? "run" : "bike";
  }

  return data;
};

// ==========================================
// CALCULS
// ==========================================
const ZCOL = {
  Z1: "rgba(219, 234, 254, 0.75)",
  Z2: "rgba(220, 252, 231, 0.75)",
  Z3: "rgba(254, 249, 195, 0.75)",
  Z4: "rgba(255, 237, 213, 0.75)",
  Z5: "rgba(255, 228, 230, 0.75)",
};

// Couleurs opaques pour les graphiques Recharts
const ZCOL_CHART = {
  Z1: "#DBEAFE",
  Z2: "#DCFCE7",
  Z3: "#FEF9C3",
  Z4: "#FFEDD5",
  Z5: "#FFE4E6",
};

const ZHEX = {
  Z1: "DBEAFE",
  Z2: "DCFCE7",
  Z3: "FEF9C3",
  Z4: "FFEDD5",
  Z5: "FFE4E6",
  HEADER: "1F4E8C",
  BORDER: "94A3B8",
};

const zoneOfFc = (fc, fc1, fc2, sportType = "endurance") => {
  if (sportType === "other") {
    if (fc < fc1) return "Z1";
    if (fc < fc2) return "Z2";
    return "Z3";
  }

  const mid = Math.round((fc1 + fc2) / 2);
  const z4max = Math.round(fc2 * 1.05);
  if (fc < fc1) return "Z1";
  if (fc < mid) return "Z2";
  if (fc < fc2) return "Z3";
  if (fc <= z4max) return "Z4";
  return "Z5";
};

const buildZoneSegments = (cd, fc1, fc2, sportType) => {
  if (!cd?.length) return [];
  const pts = cd
    .filter((p) => Number.isFinite(p.timeSeconds) && Number.isFinite(p.fcS || p.fc))
    .sort((a, b) => a.timeSeconds - b.timeSeconds);

  if (!pts.length) return [];

  const segs = [];
  const fc = pts[0].fcS || pts[0].fc;
  let curZ = zoneOfFc(fc, fc1, fc2, sportType);
  let startX = pts[0].timeSeconds;

  for (let i = 1; i < pts.length; i++) {
    const fcVal = pts[i].fcS || pts[i].fc;
    const z = zoneOfFc(fcVal, fc1, fc2, sportType);
    if (z !== curZ) {
      const endX = pts[i].timeSeconds;
      if (endX > startX) segs.push({ z: curZ, x1: startX, x2: endX });
      curZ = z;
      startX = pts[i].timeSeconds;
    }
  }
  const lastX = pts[pts.length - 1].timeSeconds;
  if (lastX > startX) segs.push({ z: curZ, x1: startX, x2: lastX });

  // Filtrer les petits segments (< 15 secondes) et les fusionner avec le segment précédent
  const MIN_SEGMENT_DURATION = 15;
  const filtered = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const duration = seg.x2 - seg.x1;

    if (duration >= MIN_SEGMENT_DURATION) {
      filtered.push(seg);
    } else if (filtered.length > 0) {
      // Fusionner avec le segment précédent en étendant sa durée
      filtered[filtered.length - 1].x2 = seg.x2;
    } else {
      // Si c'est le premier segment et qu'il est trop court, le garder quand même
      filtered.push(seg);
    }
  }

  return filtered;
};

const zoneLabel = (z) =>
  ({
    Z1: "Sous V1",
    Z2: "V1 → milieu",
    Z3: "Milieu → V2",
    Z4: "V2 → +5%",
    Z5: "> V2 +5%",
  })[z] || z;

const calcAge = (birth, test) => {
  if (!birth) return 0;
  const p = birth.split("/");
  if (p.length !== 3) return 0;
  const b = new Date(+p[2], +p[1] - 1, +p[0]);
  let t = new Date();
  if (test) {
    const tp = test.split(" ")[0].split("/");
    if (tp.length === 3) t = new Date(+tp[2], +tp[1] - 1, +tp[0]);
  }
  let age = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--;
  return Math.round(age * 10) / 10;
};

const getExData = (m) => {
  const ex = m.filter((x) => x.phase && !x.phase.includes("Repos") && !x.phase.includes("Rétablissement"));
  if (!ex.length) return m.filter((x) => x.phase && !x.phase.includes("Repos")).slice(0, 500);
  const t0 = ex[0]?.timeSeconds || 0;
  return ex.map((x) => ({ ...x, timeSeconds: x.timeSeconds - t0 }));
};

const smooth = (d, w = 30) => {
  if (!d || d.length < w) return d.map((p) => ({ ...p, vo2S: p.vo2, fcS: Math.round(win.reduce((a, x) => a + x.fc, 0) / win.length),
      veS: p.ve }));
  const r = Math.max(1, Math.floor(d.length / 2000));
  const s = d.filter((_, i) => i % r === 0);

  return s.map((p, i) => {
    const st = Math.max(0, i - Math.floor(w / r / 2));
    const en = Math.min(s.length, i + Math.floor(w / r / 2));
    const win = s.slice(st, en);
    return {
      ...p,
      vo2S: Math.round((win.reduce((a, x) => a + x.vo2, 0) / win.length) * 100) / 100,
      fcS: Math.round(win.reduce((a, x) => a + x.fc, 0) / win.length),
      veS: Math.round((win.reduce((a, x) => a + x.ve, 0) / win.length) * 100) / 100,
    };
  });
};

const calcZones = (sportType, fc1, fc2, s1, s2, testType = "run") => {
  const formatValue = (v) => Math.round(v * 10) / 10;
  const isDecimal = testType === "run"; // km/h uses decimals, Watts use integers
  const unit = testType === "bike" ? " W" : " km/h";

  const formatWithUnit = (v) => {
    if (isDecimal) return `${formatValue(v)}${unit}`;
    return `${Math.round(v)}${unit}`;
  };

  if (sportType === "other") {
    return [
      { z: "Z1", fc: `< ${fc1}`, sp: `< ${formatWithUnit(s1)}`, det: "Sous V1 (seuil ventilatoire 1)", col: ZCOL.Z1 },
      { z: "Z2", fc: `${fc1} – ${fc2}`, sp: `${formatWithUnit(s1)} – ${formatWithUnit(s2)}`, det: "Entre V1 et V2", col: ZCOL.Z2 },
      { z: "Z3", fc: `> ${fc2}`, sp: `> ${formatWithUnit(s2)}`, det: "Au-dessus de V2 (seuil ventilatoire 2)", col: ZCOL.Z3 },
    ];
  }

  const mid = Math.round((fc1 + fc2) / 2);
  const mids = (s1 + s2) / 2;
  const z4fc = Math.round(fc2 * 1.05);
  const z4s = s2 * 1.05;

  return [
    { z: "Z1", fc: `< ${fc1}`, sp: `< ${formatWithUnit(s1)}`, det: "Sous V1 (seuil ventilatoire 1)", col: ZCOL.Z1 },
    { z: "Z2", fc: `${fc1} – ${mid}`, sp: `${formatWithUnit(s1)} – ${formatWithUnit(mids)}`, det: "Entre V1 et le milieu (S1+S2)/2", col: ZCOL.Z2 },
    { z: "Z3", fc: `${mid} – ${fc2}`, sp: `${formatWithUnit(mids)} – ${formatWithUnit(s2)}`, det: "Entre le milieu et V2 (seuil ventilatoire 2)", col: ZCOL.Z3 },
    { z: "Z4", fc: `${fc2} – ${z4fc}`, sp: `${formatWithUnit(s2)} – ${formatWithUnit(z4s)}`, det: "Au-dessus de V2 (jusqu'à +5 %)", col: ZCOL.Z4 },
    { z: "Z5", fc: `> ${z4fc}`, sp: `> ${formatWithUnit(z4s)}`, det: "Très au-dessus de V2 (> +5 %)", col: ZCOL.Z5 },
  ];
};

const genRec = (fc1, fc2, s1, vo2, testType = "run") => {
  const w = fc2 - fc1;
  const lvl = vo2 < 35 ? "D" : vo2 >= 45 ? "A" : "I";
  const z2w = Math.round((fc1 + fc2) / 2) - fc1;

  const ana =
    w < 8 ? `Zones étroites (${w} bpm). Priorité: élargir via Z2.` :
    w < 12 ? `Zones relativement étroites. Objectif: les élargir.` :
    w < 18 ? `Zones modérées (${w} bpm). Bonne flexibilité.` :
    `Zones bien espacées (${w} bpm). Excellente adaptation.`;

  const intensityUnit = testType === "bike" ? `${Math.round(s1)} W` : `${s1.toFixed(1)} km/h`;
  const activityType = testType === "bike" ? "vélo" : "course";

  let pri, comp, hi;
  if (lvl === "D") {
    pri = `Z2: 3-4×/sem (30-60 min) sous ${fc1} bpm. Construire la base aérobie.`;
    comp = `Z1: récup active (${testType === "bike" ? "pédalage léger" : "marche, footing lent"}). Régularité > intensité.`;
    hi = `Z3-5: éviter 8-12 semaines. Focus volume Z2.`;
  } else if (lvl === "A") {
    pri = `Z2: 2-3×/sem (60-120 min) à ${intensityUnit}. Endurance lipidique.`;
    comp = `Z3: 1-2×/sem tempo (20-40 min) ou 4×10 min progressif en ${activityType}.`;
    hi = `Z4-5: 1×/sem intervalles${testType === "run" ? "/côtes" : ""}. 48h récup après.`;
  } else {
    pri = `Z2: 2-3×/sem (45-90 min) allure confortable. Base aérobie.`;
    comp = `Z3: 1×/sem blocs 5-10 min (3-4×8 min) + récup courte.`;
    hi = `Z4-5: occasionnel, non prioritaire pour endurance.`;
  }

  const spec =
    z2w < 5 ? `⚠️ Z2 étroite (${z2w} bpm). Max ${fc1 + z2w} bpm en sortie longue.` : "";

  return { ana, pri, comp, hi, spec, fu: "Retest conseillé dans 8-12 semaines.", lvl };
};

// ==========================================
// CAPTURE CHART ROBUSTE
// ==========================================
const waitPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const b64ToU8 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const captureChartWithRetry = async (id, retries = CONFIG.CHART_CAPTURE_RETRIES) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await captureChartAttempt(id);
      if (result) return result;
    } catch (e) {
      console.warn(`Tentative ${attempt + 1}/${retries + 1} échouée:`, e.message);
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return null;
};

const captureChartAttempt = async (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable`);

  if (document.fonts?.ready) await document.fonts.ready;
  await waitPaint();

  const rect = el.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  if (width === 0 || height === 0) throw new Error(`Dimensions invalides pour #${id}: ${width}x${height}`);

  return await Promise.race([
    html2canvas(el, {
      backgroundColor: "#fff",
      scale: 2,
      useCORS: true,
      logging: false,
      width,
      height,
      onclone: (doc) => {
        const clone = doc.getElementById(id);
        if (clone) {
          clone.style.width = width + "px";
          clone.style.height = height + "px";
          clone.style.overflow = "visible";
        }
      },
    }).then((canvas) => ({ b64: canvas.toDataURL("image/png").split(",")[1], w: canvas.width, h: canvas.height })),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout capture")), CONFIG.CHART_CAPTURE_TIMEOUT)),
  ]);
};

// ==========================================
// GÉNÉRATION DOCX
// ==========================================
const genDocx = async (data, zonesTable, rec, name, age, poids, fc1, fc2, s1, s2, vo2, vo2kg, testType = "run") => {
  const intensityLabel = testType === "bike" ? "Puissance (W)" : "Vitesse (km/h)";
  const intensityUnit = testType === "bike" ? "W" : "km/h";
  const formatIntensity = (v) => testType === "bike" ? Math.round(v) : v.toFixed(1);
  const border = { style: BorderStyle.SINGLE, size: 1, color: "94A3B8" };
  const bs = { top: border, bottom: border, left: border, right: border };

  const vo2Cap = await captureChartWithRetry("vo2c");
  const veCap = await captureChartWithRetry("vec");

  const ch = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: "Compte rendu d'épreuve d'effort – Endurance", bold: true, size: 32 })],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: `Patient${data.patient.sexe === "femme" ? "e" : ""}: `, bold: true, size: 22 }),
        new TextRun({ text: name, size: 22 }),
      ],
    }),
    new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: `Âge: ${age} ans | Poids: ${poids}`, size: 22 })] }),
    new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: `VO₂peak: ${vo2.toFixed(2)} L/min (${vo2kg} ml·kg⁻¹·min⁻¹)`, size: 22 })] }),
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: `Seuils: V1=${fc1} bpm/${formatIntensity(s1)} ${intensityUnit} ; V2=${fc2} bpm/${formatIntensity(s2)} ${intensityUnit}`, size: 22 })],
    }),
    new Paragraph({ spacing: { before: 60, after: 50 }, children: [new TextRun({ text: "Zones d'entraînement personnalisées", bold: true, size: 26 })] }),
  ];

  ch.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({ borders: bs, shading: { fill: ZHEX.HEADER, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: "Zone", bold: true, color: "FFFFFF", size: 20 })] })] }),
            new TableCell({ borders: bs, shading: { fill: ZHEX.HEADER, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: "FC (bpm)", bold: true, color: "FFFFFF", size: 20 })] })] }),
            new TableCell({ borders: bs, shading: { fill: ZHEX.HEADER, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: intensityLabel, bold: true, color: "FFFFFF", size: 20 })] })] }),
            new TableCell({ borders: bs, shading: { fill: ZHEX.HEADER, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: "Détermination (seuils)", bold: true, color: "FFFFFF", size: 20 })] })] }),
          ],
        }),
        ...zonesTable.map((z) =>
          new TableRow({
            children: [
              new TableCell({ borders: bs, shading: { fill: ZHEX[z.z], type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: z.z, bold: true, size: 20 })] })] }),
              new TableCell({ borders: bs, shading: { fill: ZHEX[z.z], type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: z.fc, size: 20 })] })] }),
              new TableCell({ borders: bs, shading: { fill: ZHEX[z.z], type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: z.sp, size: 20 })] })] }),
              new TableCell({ borders: bs, shading: { fill: ZHEX[z.z], type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: z.det, size: 20 })] })] }),
            ],
          }),
        ),
      ],
    }),
  );

  ch.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: "Comprendre V1 et V2", bold: true, size: 24 })] }));
  ch.push(new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({
      text: "V1 (seuil ventilatoire 1) correspond à l'intensité à partir de laquelle l'organisme commence à produire davantage de métabolites (notamment liés au métabolisme anaérobie), mais reste encore capable de les évacuer efficacement. À cette intensité, l'équilibre est maintenu : l'effort est durable, la respiration s'accélère légèrement mais reste contrôlée.",
      size: 20
    })]
  }));
  ch.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({
      text: "V2 (seuil ventilatoire 2) correspond à une intensité plus élevée à partir de laquelle la production de métabolites devient supérieure à la capacité d'élimination de l'organisme. Cela entraîne une augmentation marquée de la ventilation et une fatigue qui s'installe plus rapidement. Au-dessus de V2, l'effort est efficace mais ne peut être maintenu que sur des durées limitées.",
      size: 20
    })]
  }));

  ch.push(new Paragraph({ spacing: { before: 100, after: 50 }, children: [new TextRun({ text: "VO₂ et FC avec seuils et zones", bold: true, size: 26 })] }));

  const pushChart = (cap, title) => {
    if (!cap) {
      ch.push(new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: `${title} - capture indisponible`, italic: true, color: "999999", size: 20 })] }));
      return;
    }
    const targetW = 520;
    const targetH = Math.round(targetW * (cap.h / cap.w));
    ch.push(new Paragraph({ spacing: { before: 30, after: 30 }, children: [new TextRun({ text: title, bold: true, size: 22 })] }));
    ch.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [new ImageRun({ type: "png", data: b64ToU8(cap.b64), transformation: { width: targetW, height: targetH } })],
      }),
    );
  };

  pushChart(vo2Cap, "Graphique VO₂");
  pushChart(veCap, "Graphique FC");

  ch.push(new Paragraph({ children: [new PageBreak()] }));
  ch.push(new Paragraph({ spacing: { before: 50, after: 60 }, children: [new TextRun({ text: "Recommandations", bold: true, size: 26 })] }));
  ch.push(new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: rec.ana, size: 22 })] }));
  ch.push(new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: rec.pri, size: 22 })] }));
  ch.push(new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: rec.comp, size: 22 })] }));
  ch.push(new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: rec.hi, size: 22 })] }));
  if (rec.spec) ch.push(new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: rec.spec, italics: true, size: 22 })] }));
  ch.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: rec.fu, italics: true, size: 22 })] }));

  return new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 600, right: 720, bottom: 600, left: 720 } } }, children: ch }],
  });
};

const dlDocx = async (data, zonesTable, rec, name, age, poids, fc1, fc2, s1, s2, vo2, vo2kg, testType, setExp, setErr) => {
  setExp(true);
  setErr(null);
  try {
    await waitPaint();
    const doc = await genDocx(data, zonesTable, rec, name, age, poids, fc1, fc2, s1, s2, vo2, vo2kg, testType);
    const blob = await Packer.toBlob(doc);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Rapport_TCP_${name.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.docx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) {
    console.error("Erreur génération DOCX:", e);
    setErr(`Échec export DOCX: ${e.message || "Erreur inconnue"}`);
  } finally {
    setExp(false);
  }
};

export default function App() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);
  const [load, setLoad] = useState(false);
  const [exp, setExp] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [sportType, setSportType] = useState("endurance");

  const onFile = useCallback((f) => {
    if (!f) { setErr(new ValidationError("Aucun fichier sélectionné")); return; }
    if (!f.name.endsWith(".xml")) { setErr(new ValidationError("Format invalide. Fichier XML requis.")); return; }
    if (f.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) { setErr(new ValidationError(`Fichier trop volumineux (max ${CONFIG.MAX_FILE_SIZE_MB}MB)`)); return; }

    setErr(null);
    setData(null);
    setPendingFile(f);
  }, []);

  const processPendingFile = useCallback(() => {
    if (!pendingFile) { setErr(new ValidationError("Aucun fichier sélectionné")); return; }
    setLoad(true);
    setErr(null);

    const r = new FileReader();
    r.onerror = () => { setErr(new ValidationError("Échec de lecture du fichier")); setLoad(false); };

    r.onload = (e) => {
      try {
        const parsed = parseXMLSafe(e.target.result);
        validateParsedData(parsed);
        setData(parsed);
        setErr(null);
        setPendingFile(null);
      } catch (x) {
        console.error("Erreur parsing/validation:", x);
        setErr(x);
      } finally {
        setLoad(false);
      }
    };

    r.readAsText(pendingFile);
  }, [pendingFile]);;

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-xl w-full text-center">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Générateur de Rapport TCP</h1>
          <p className="text-gray-600 mb-4">Endurance longue distance - Version Production</p>
          <div className="inline-flex items-center gap-2 bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm mb-6">
            🔒 Données 100% locales • [version 1.0]
          </div>

          <div
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDrag(false); }}
            className={`border-2 border-dashed rounded-2xl p-12 bg-white shadow-lg cursor-pointer transition-all ${
              drag ? "border-blue-500 bg-blue-50 scale-105" : "border-gray-300 hover:border-blue-400"
            }`}
            role="button"
            aria-label="Zone de dépôt de fichier"
          >
            <input
              type="file"
              accept=".xml"
              onChange={(e) => onFile(e.target.files[0])}
              className="hidden"
              id="fi"
              aria-label="Sélectionner un fichier XML"
            />
            <label htmlFor="fi" className="cursor-pointer">
              <div className="text-6xl mb-4" aria-hidden="true">{load ? "⏳" : "📄"}</div>
              <p className="text-lg font-medium text-gray-700">{load ? "Validation en cours..." : "Glissez votre fichier XML"}</p>
              <p className="text-gray-500 text-sm">ou cliquez pour sélectionner</p>
              <p className="text-gray-400 text-xs mt-2">Max {CONFIG.MAX_FILE_SIZE_MB}MB</p>
            </label>
          </div>
          {pendingFile && (
            <div className="mt-4 space-y-3">
              <div className="meta-card text-left">
                <div className="text-[12px] font-extrabold text-slate-800 mb-2">Type de sport</div>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                  <select
                    className="w-full sm:w-auto border border-slate-300 rounded-xl px-3 py-2 text-[13px] bg-white"
                    value={sportType}
                    onChange={(e) => setSportType(e.target.value)}
                    aria-label="Choisir le type de sport"
                  >
                    <option value="endurance">Endurance (5 zones)</option>
                    <option value="other">Autres sports (3 zones)</option>
                  </select>

                  <button
                    type="button"
                    onClick={processPendingFile}
                    disabled={load}
                    className={`w-full sm:w-auto px-4 py-2 rounded-xl font-extrabold text-white ${
                      load ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {load ? "Traitement..." : "Générer le rapport"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setPendingFile(null)}
                    disabled={load}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl font-extrabold border border-slate-300 bg-white hover:bg-slate-50"
                  >
                    Changer de fichier
                  </button>
                </div>
                <div className="text-[12px] text-slate-600 mt-2 truncate">
                  Fichier sélectionné : <span className="font-semibold">{pendingFile.name}</span>
                </div>
              </div>
            </div>
          )}


          {err && <ErrorDisplay error={err} onDismiss={() => setErr(null)} />}
        </div>
      </div>
    );
  }

  const name = `${data.patient.nom || ""} ${data.patient.prenom || ""}`.trim() || "Patient";
  const age = calcAge(data.patient.dateNaissance, data.test.dateHeure);
  const poids = data.patient.poids || "-";

  const testType = data.testType || "run";
  const isBike = testType === "bike";

  const fc1 = safeNum(data.vt1.fc);
  const fc2 = safeNum(data.vt2.fc);
  const s1 = isBike ? safeNum(data.vt1.power) : safeNum(data.vt1.vitesse);
  const s2 = isBike ? safeNum(data.vt2.power) : safeNum(data.vt2.vitesse);
  const vo2 = safeNum(data.peakVO2.vo2);
  const vo2kg = safeNum(data.peakVO2.vo2kg);

  const intensityLabel = isBike ? "Puissance" : "Vitesse";
  const intensityUnit = isBike ? "W" : "km/h";

  const rec = genRec(fc1, fc2, s1, vo2kg, testType);

  const cdRaw = smooth(getExData(data.measurements), 30);
  const cd = cdRaw.filter((p) => Number.isFinite(p.timeSeconds));

  const zoneSegs = buildZoneSegments(cd, fc1, fc2, sportType);
  const zonesTable = calcZones(sportType, fc1, fc2, s1, s2, testType);
  const zonesList = sportType === "other" ? ["Z1","Z2","Z3"] : ["Z1","Z2","Z3","Z4","Z5"];

  const CHART_MARGIN = { top: 8, right: 18, left: 28, bottom: 26 };

  const printNow = async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await waitPaint();
    window.print();
  };


  return (
    <div className="min-h-screen bg-gray-100">
      <div className="no-print bg-white shadow border-b p-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex justify-between items-center flex-wrap gap-3">
          <button
            onClick={() => { setData(null); setErr(null); }}
            className="text-gray-600 hover:text-gray-800 transition-colors"
            aria-label="Charger un nouveau fichier"
            type="button"
          >
            ← Nouveau
          </button>

          <button
            onClick={() => setShowFeedback(true)}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-medium transition-colors"
            aria-label="Donner votre avis"
            type="button"
          >
            💬 Feedback
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => dlDocx(data, zonesTable, rec, name, age, poids, fc1, fc2, s1, s2, vo2, vo2kg, testType, setExp, setErr)}
              disabled={exp}
              className={`px-4 py-2 rounded text-white font-medium transition-all ${exp ? "bg-gray-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"}`}
              aria-label={exp ? "Export DOCX en cours" : "Exporter en DOCX"}
              type="button"
            >
              {exp ? "⏳ Export..." : "📝 DOCX"}
            </button>

            <button
              onClick={printNow}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium transition-colors"
              aria-label="Imprimer ou exporter en PDF"
              type="button"
            >
              🖨️ PDF
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div className="no-print max-w-4xl mx-auto mt-4 px-4">
          <ErrorDisplay error={err} onDismiss={() => setErr(null)} />
        </div>
      )}

      <FeedbackModal isOpen={showFeedback} onClose={() => setShowFeedback(false)} patientName={name} />

      <div className="print-container mx-auto shadow-lg my-6 print:my-0 print:shadow-none" style={{ maxWidth: "210mm" }}>
        {/* PAGE 1 */}
        <div className="a4-page">
          <div className="avoid-break">
            <div className="report-title">Compte rendu de test d'effort</div>
            <div className="report-sub">VO₂ et FC avec seuils et zones</div>

            <div className="meta-card mt-3 text-[12px] text-slate-700">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <div>
                  <b>Patient{data.patient.sexe === "femme" ? "e" : ""} :</b> {name}
                </div>
                <div><b>Âge :</b> {age} ans</div>
                <div><b>Poids :</b> {poids}</div>
              </div>
              <div className="mt-1">
                <b>VO₂peak :</b> {vo2.toFixed(2)} L/min ({vo2kg} ml·kg⁻¹·min⁻¹)
                <span className="mx-2">|</span>
                <b>V1 :</b> {fc1} bpm / {isBike ? Math.round(s1) : s1.toFixed(1)} {intensityUnit}
                <span className="mx-2">|</span>
                <b>V2 :</b> {fc2} bpm / {isBike ? Math.round(s2) : s2.toFixed(1)} {intensityUnit}
              </div>
            </div>

            <div className="mt-3 meta-card">
              <div className="text-[12px] font-extrabold text-slate-800 mb-2">Comprendre V1 et V2</div>
              <div className="text-[12px] text-slate-700 space-y-2">
                <p>
                  V1 (seuil ventilatoire 1) correspond à l’intensité à partir de laquelle l’organisme commence à produire davantage de métabolites (notamment liés au métabolisme anaérobie), mais reste encore capable de les évacuer efficacement. À cette intensité, l’équilibre est maintenu : l’effort est durable, la respiration s’accélère légèrement mais reste contrôlée.
                </p>
                <p>
                  V2 (seuil ventilatoire 2) correspond à une intensité plus élevée à partir de laquelle la production de métabolites devient supérieure à la capacité d’élimination de l’organisme. Cela entraîne une augmentation marquée de la ventilation et une fatigue qui s’installe plus rapidement. Au-dessus de V2, l’effort est efficace mais ne peut être maintenu que sur des durées limitées.
                </p>
              </div>
            </div>

            <div className="mt-4">
              <h2 className="text-[13px] font-extrabold text-slate-800 mb-2">Zones d'entraînement personnalisées</h2>

              <table className="zones-table w-full border-collapse" role="table" aria-label="Tableau des zones d'entraînement">
                <thead>
                  <tr>
                    <th scope="col">Zone</th>
                    <th scope="col">FC (bpm)</th>
                    <th scope="col">{intensityLabel} ({intensityUnit})</th>
                    <th scope="col">Détermination (seuils)</th>
                  </tr>
                </thead>
                <tbody>
                  {zonesTable.map((z) => (
                    <tr key={z.z} style={{ background: z.col }}>
                      <td><span className="badge">{z.z}</span></td>
                      <td className="font-semibold">{z.fc}</td>
                      <td className="font-semibold">{z.sp}</td>
                      <td>{z.det}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="avoid-break">
            <div id="vo2c" className="chart-box">
              <div className="chart-title">VO₂ (moyenne 30 s) avec seuils et zones</div>
              <div className="chart-inner">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cd} margin={CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    {zoneSegs.map((s, i) => (
                      <ReferenceArea
                        key={i}
                        x1={s.x1}
                        x2={s.x2}
                        fill={ZCOL_CHART[s.z]}
                        fillOpacity={0.6}
                        strokeOpacity={0}
                      />
                    ))}
                    <ReferenceLine
                      x={cd.find((p) => p.fc >= fc1)?.timeSeconds || 0}
                      stroke="var(--zline1)"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      label="V1"
                    />
                    <ReferenceLine
                      x={cd.find((p) => p.fc >= fc2)?.timeSeconds || 0}
                      stroke="var(--zline2)"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      label="V2"
                    />
                    <XAxis
                      dataKey="timeSeconds"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => Math.round(v)}
                      label={{ value: "Temps (s)", position: "insideBottom", offset: -10, fontSize: 10 }}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 10 }}
                      label={{ value: "VO₂ (L/min)", angle: -90, position: "insideLeft", fontSize: 10 }}
                    />
                    <Line type="monotone" dataKey="vo2S" stroke="#1976d2" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ZoneLegend ZCOL={ZCOL} zoneLabel={zoneLabel} zones={zonesList} />
            </div>
          </div>
        </div>

        {/* PAGE 2 */}
        <div className="a4-page">
          <div className="avoid-break">
            <div id="vec" className="chart-box">
              <div className="chart-title">FC (moyenne 30 s) avec seuils et zones</div>
              <div className="chart-inner">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cd} margin={CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    {zoneSegs.map((s, i) => (
                      <ReferenceArea
                        key={i}
                        x1={s.x1}
                        x2={s.x2}
                        fill={ZCOL_CHART[s.z]}
                        fillOpacity={0.6}
                        strokeOpacity={0}
                      />
                    ))}
                    <ReferenceLine
                      x={cd.find((p) => p.fc >= fc1)?.timeSeconds || 0}
                      stroke="var(--zline1)"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      label="V1"
                    />
                    <ReferenceLine
                      x={cd.find((p) => p.fc >= fc2)?.timeSeconds || 0}
                      stroke="var(--zline2)"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      label="V2"
                    />
                    <XAxis
                      dataKey="timeSeconds"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => Math.round(v)}
                      label={{ value: "Temps (s)", position: "insideBottom", offset: -10, fontSize: 10 }}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 10 }}
                      label={{ value: "FC (bpm)", angle: -90, position: "insideLeft", fontSize: 10 }}
                    />
                    <Line type="monotone" dataKey="fcS" stroke="#1976d2" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ZoneLegend ZCOL={ZCOL} zoneLabel={zoneLabel} zones={zonesList} />
            </div>
          </div>

          <div className="avoid-break">
            <h2 className="text-[13px] font-extrabold text-slate-800 mt-2 mb-2">Recommandations d'entraînement</h2>
            <div className="text-[12px] text-slate-700 space-y-2">
              <p>{rec.ana}</p>
              <p>{rec.pri}</p>
              <p>{rec.comp}</p>
              <p>{rec.hi}</p>
              {rec.spec && (
                <p className="p-2 rounded border-l-4" style={{ background: ZCOL.Z3, borderColor: "#eab308" }}>
                  {rec.spec}
                </p>
              )}
              <p className="italic">{rec.fu}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="no-print text-center py-6 text-sm text-gray-500">
        🔒 Données traitées localement. Aucun envoi externe (hors feedback). • v2.1
      </div>
    </div>
  );
}