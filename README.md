<a href="https://github.com/doctorfill-dev">
  <img src="https://github.com/doctorfill-dev/.github/blob/main/assets/DF_512x512.png?raw=true" alt="DoctorFill" width="48" align="left" style="margin-right: 16px;" />
</a>

# TCP Report Generator

**Transform raw XML stress test data into professional DOCX reports — entirely in your browser.**

[![Version](https://img.shields.io/badge/version-2.2.0-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-18.3-61DAFB.svg?logo=react)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF.svg?logo=vite)](https://vitejs.dev/)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-success.svg)](#privacy)
[![Deploy](https://github.com/doctorfill-dev/medsport-report/actions/workflows/pages.yml/badge.svg)](https://github.com/doctorfill-dev/medsport-report/actions/workflows/pages.yml)

---

## Why TCP Report Generator?

Built for healthcare and sports science professionals, this tool converts metabolic stress test data into comprehensive Word documents. Part of the [DoctorFill](https://github.com/doctorfill-dev) ecosystem — where patient data privacy is non-negotiable.

**Everything runs locally.** No servers. No uploads. No compromises.

---

## Features

| | |
|---|---|
| **Privacy First** | All processing happens in your browser. Your data never leaves your machine. |
| **XML → DOCX** | Drop your XML file, get a formatted Word document. That simple. |
| **Smart Calculations** | Ventilatory thresholds (V1, V2), training zones — calculated automatically. |
| **Visual Insights** | Clean VO₂ and Heart Rate charts that tell the story at a glance. |
| **Flexible Zones** | 5-zone model for endurance sports, 3-zone for everything else. |

---

## How It Works

**Upload** your XML → **Select** your sport type → **Generate** → **Export** to DOCX

That's it.

---

## Privacy

This tool follows a **zero-transmission architecture**. File parsing, data processing, and document generation all happen exclusively within your browser. No patient data is ever sent to any server.

> The only exception is the optional feedback form, which uses Formspree to collect user suggestions.

---

## Tech Stack

Built with modern, reliable tools:

**React** · **Vite** · **Tailwind CSS** · **Recharts** · **Docxtemplater** · **PizZip** · **html2canvas**

---

## Getting Started

```bash
# Clone
git clone <repository-url>
cd report-generator

# Install
npm install

# Configure (for feedback form)
echo 'VITE_FORMSPREE_ENDPOINT="<your-endpoint>"' > .env
echo 'VITE_RECAPTCHA_SITE_KEY="<your-key>"' >> .env

# Run
npm run dev
```

Open [localhost:5173](http://localhost:5173) and you're ready.

---

## Contributing

Found a bug? Have an idea? [Open an issue](../../issues) or submit a pull request.

---

## License

MIT © [DoctorFill](https://github.com/doctorfill-dev)
