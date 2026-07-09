import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = path.join(ROOT, "scores.csv");
const OUTPUT_PATH = path.join(ROOT, "results", "stats-data.js");
const PROBLEMS = [1, 2, 3, 4, 5, 6];

const TEAM_NAMES = {
  ALB: "Albania",
  BGD: "Bangladesh",
  BIH: "Bosnia & Herzegovina",
  BJ: "China Beijing",
  BRA: "Brazil",
  BWA: "Botswana",
  CHB: "China Hubei",
  CHN: "China",
  CMR: "Cameroon",
  CRI: "Costa Rica",
  CRO: "Croatia",
  CUB: "Cuba",
  CZE: "Czech Republic",
  EST: "Estonia",
  GHA: "Ghana",
  HKG: "Hong Kong",
  HND: "Honduras",
  IDN: "Indonesia",
  INT1: "International Union I",
  INT2: "International Union II",
  IRL: "Ireland",
  IRN: "Iran",
  ISL: "Iceland",
  ITA: "Italy",
  KGZ: "Kyrgyzstan",
  LTU: "Lithuania",
  MAC: "Macau",
  MAS: "Malaysia",
  MDA: "Moldova",
  MEX: "Mexico",
  MKD: "North Macedonia",
  MMR: "Myanmar",
  MNE: "Montenegro",
  MNG: "Mongolia",
  NMG: "China Inner Mongolia",
  NPL: "Nepal",
  PAK: "Pakistan",
  PER: "Peru",
  POL: "Poland",
  RWA: "Rwanda",
  SRB: "Serbia",
  THA: "Thailand",
  TJK: "Tajikistan",
  TKM: "Turkmenistan",
  UGA: "Uganda",
  URY: "Uruguay",
  UZB: "Uzbekistan",
  VNM: "Vietnam",
  ZAF: "South Africa"
};

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      if (quoted && line[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function parsePaperCode(rawCode) {
  const intMatch = rawCode.match(/^(INT[12])(\d{3})$/);
  if (intMatch) return { teamCode: intMatch[1], teamIndex: Number(intMatch[2]) };
  const match = rawCode.match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Could not parse code: ${rawCode}`);
  return { teamCode: match[1], teamIndex: Number(match[2]) };
}

function round(value, places = 2) {
  if (value == null || Number.isNaN(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function summarizeValues(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return { count: 0, mean: null, median: null, min: null, max: null, q1: null, q3: null, stdev: null };
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length;
  return {
    count: clean.length,
    mean: round(mean),
    median: round(percentile(clean, 0.5)),
    min: clean[0],
    max: clean.at(-1),
    q1: round(percentile(clean, 0.25)),
    q3: round(percentile(clean, 0.75)),
    stdev: round(Math.sqrt(variance))
  };
}

function distribution(values, min, max) {
  const buckets = new Map();
  for (let value = min; value <= max; value += 1) buckets.set(value, 0);
  for (const value of values) buckets.set(value, (buckets.get(value) || 0) + 1);
  return [...buckets.entries()].map(([value, count]) => ({ value, count }));
}

function readRows() {
  const lines = fs.readFileSync(CSV_PATH, "utf8").replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const codeIndex = header.indexOf("Code");
  const problemColumns = PROBLEMS.map(problem => ({ problem, index: header.indexOf(`P${problem}`) }));
  const rows = [];

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const code = (cells[codeIndex] || "").trim();
    if (!code) continue;
    const { teamCode, teamIndex } = parsePaperCode(code);
    const scores = Object.fromEntries(problemColumns.map(({ problem, index }) => [problem, Number(cells[index] || 0)]));
    rows.push({
      code,
      teamCode,
      teamName: TEAM_NAMES[teamCode] || teamCode,
      teamIndex,
      scores
    });
  }

  return rows;
}

function buildStats(rows) {
  const individualTotals = rows.map(row => PROBLEMS.reduce((sum, problem) => sum + row.scores[problem], 0));
  const teams = new Map();

  for (const row of rows) {
    if (!teams.has(row.teamCode)) teams.set(row.teamCode, { teamName: row.teamName, total: 0 });
    teams.get(row.teamCode).total += PROBLEMS.reduce((sum, problem) => sum + row.scores[problem], 0);
  }

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      students: rows.length,
      teams: teams.size
    },
    individualTotals: {
      distribution: distribution(individualTotals, 0, 42),
      stats: summarizeValues(individualTotals)
    },
    problemScores: Object.fromEntries(PROBLEMS.map(problem => {
      const scores = rows.map(row => row.scores[problem]);
      return [problem, {
        distribution: distribution(scores, 0, 7),
        stats: summarizeValues(scores)
      }];
    }))
  };
}

const data = buildStats(readRows());
fs.writeFileSync(OUTPUT_PATH, `window.IMSC_STATS_DATA = ${JSON.stringify(data, null, 2)};\n`);
console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)} with ${data.counts.students} students.`);
