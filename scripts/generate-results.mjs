import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = path.join(ROOT, "results", "results-data.js");
const PAGE_SIZE = 1000;
const PROBLEMS = [1, 2, 3, 4, 5, 6];
const EXTRA_REAL_ROWS = [
  {
    team_name: "China Inner Mongolia",
    team_code: "NMG",
    team_index: 8,
    scores: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
  }
];

const TEAM_FLAG_REGION_BY_CODE = {
  ALB: "AL",
  BGD: "BD",
  BIH: "BA",
  BWA: "BW",
  BRA: "BR",
  CMR: "CM",
  CHN: "CN",
  BJ: "CN",
  CHB: "CN",
  NMG: "CN",
  CRI: "CR",
  CRO: "HR",
  CUB: "CU",
  CZE: "CZ",
  EST: "EE",
  GHA: "GH",
  HND: "HN",
  HKG: "HK",
  ISL: "IS",
  IDN: "ID",
  IRN: "IR",
  IRL: "IE",
  ITA: "IT",
  KGZ: "KG",
  LTU: "LT",
  MAC: "MO",
  MAS: "MY",
  MEX: "MX",
  MDA: "MD",
  MNG: "MN",
  MNE: "ME",
  MMR: "MM",
  NPL: "NP",
  MKD: "MK",
  PAK: "PK",
  PER: "PE",
  POL: "PL",
  RWA: "RW",
  SRB: "RS",
  ZAF: "ZA",
  TJK: "TJ",
  THA: "TH",
  TKM: "TM",
  UGA: "UG",
  URY: "UY",
  UZB: "UZ",
  VNM: "VN"
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, ".env"));
loadEnvFile(path.join(ROOT, ".env.local"));

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

function flagForCode(teamCode) {
  if (teamCode === "INT1" || teamCode === "INT2") return "🌐";
  const region = TEAM_FLAG_REGION_BY_CODE[teamCode];
  if (!region) return "🏳️";
  return [...region.toUpperCase()]
    .map(char => String.fromCodePoint(0x1f1e6 + char.charCodeAt(0) - 65))
    .join("");
}

async function supabaseFetch(endpoint, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${endpoint} failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function fetchPaperStatusRows() {
  const rows = [];
  const fields = "team_name,team_code,team_index,problem_id,agreed_score";
  const endpoint = [
    "/rest/v1/paper_status",
    `?select=${fields}`,
    "&order=team_name.asc,team_index.asc,problem_id.asc"
  ].join("");

  for (let from = 0; ; from += PAGE_SIZE) {
    const batch = await supabaseFetch(endpoint, {
      method: "GET",
      headers: {
        Range: `${from}-${from + PAGE_SIZE - 1}`
      }
    });
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

function buildResults(rows) {
  const teamsByCode = new Map();

  function addScore(row, problemId, agreedScore) {
    const teamCode = row.team_code || row.team_name || "TEAM";
    if (!teamsByCode.has(teamCode)) {
      teamsByCode.set(teamCode, {
        teamName: row.team_name || teamCode,
        teamCode,
        flag: flagForCode(teamCode),
        studentsByIndex: new Map()
      });
    }

    const team = teamsByCode.get(teamCode);
    const teamIndex = Number(row.team_index);
    if (!team.studentsByIndex.has(teamIndex)) {
      team.studentsByIndex.set(teamIndex, {
        teamIndex,
        label: `${teamCode}-${teamIndex}`,
        scores: {}
      });
    }

    const student = team.studentsByIndex.get(teamIndex);
    const problem = Number(problemId);
    if (!PROBLEMS.includes(problem)) return;
    student.scores[String(problem)] = {
      hidden: false,
      value: agreedScore == null ? null : Number(agreedScore)
    };
  }

  for (const row of rows) {
    addScore(row, row.problem_id, row.agreed_score);
  }

  for (const row of EXTRA_REAL_ROWS) {
    const existingTeam = teamsByCode.get(row.team_code || row.team_name || "TEAM");
    if (existingTeam?.studentsByIndex.has(Number(row.team_index))) continue;
    for (const problem of PROBLEMS) {
      addScore(row, problem, row.scores[problem]);
    }
  }

  const teams = [...teamsByCode.values()].map(team => {
    const students = [...team.studentsByIndex.values()]
      .sort((a, b) => a.teamIndex - b.teamIndex)
      .map((student, index) => {
        const ordinal = index + 1;
        let revealedTotal = 0;
        const scores = {};

        for (const problem of PROBLEMS) {
          const key = String(problem);
          const value = student.scores[key]?.value ?? null;
          scores[key] = {
            hidden: false,
            value
          };
          if (value != null) revealedTotal += Number(value);
        }

        return {
          label: student.label,
          teamIndex: student.teamIndex,
          ordinal,
          revealedTotal,
          scores
        };
      });

    const revealedTotal = students.reduce((sum, student) => sum + student.revealedTotal, 0);
    return {
      teamName: team.teamName,
      teamCode: team.teamCode,
      flag: team.flag,
      revealedTotal,
      students
    };
  });

  teams.sort((a, b) =>
    b.revealedTotal - a.revealedTotal ||
    a.teamName.localeCompare(b.teamName)
  );

  let previousTotal = null;
  let previousRank = 0;
  teams.forEach((team, index) => {
    const rank = previousTotal === team.revealedTotal ? previousRank : index + 1;
    team.rank = rank;
    previousTotal = team.revealedTotal;
    previousRank = rank;
  });

  return {
    generatedAt: new Date().toISOString(),
    problems: PROBLEMS,
    teams
  };
}

function writeResultsData(data) {
  const js = `window.IMSC_RESULTS_DATA = ${JSON.stringify(data, null, 2)};\n`;
  fs.writeFileSync(OUTPUT_PATH, js);
}

async function main() {
  const rows = await fetchPaperStatusRows();
  const data = buildResults(rows);
  writeResultsData(data);
  const studentCount = data.teams.reduce((sum, team) => sum + team.students.length, 0);
  console.log(`Fetched ${rows.length} paper rows.`);
  console.log(`Wrote ${data.teams.length} teams and ${studentCount} students to ${path.relative(ROOT, OUTPUT_PATH)}.`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
