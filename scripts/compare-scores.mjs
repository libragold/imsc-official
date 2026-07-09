import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = path.join(ROOT, "scores.csv");
const REPORT_PATH = path.join(ROOT, "tmp", "scores-diff-report.md");
const DETAIL_PATH = path.join(ROOT, "tmp", "scores-diff.csv");
const DB_SNAPSHOT_PATH = path.join(ROOT, "tmp", "scores-db-snapshot.csv");
const TEAM_PROBLEM_REPORT_PATH = path.join(ROOT, "tmp", "team-problem-diff-report.md");
const TEAM_PROBLEM_DETAIL_PATH = path.join(ROOT, "tmp", "team-problem-diff.csv");
const PAGE_SIZE = 1000;
const PROBLEMS = [1, 2, 3, 4, 5, 6];
const TEAM_CODE_ALIASES = new Map([
  ["ABL", "ALB"]
]);

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

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
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

function normalizeTeamCode(code) {
  return TEAM_CODE_ALIASES.get(code) || code;
}

function parsePaperCode(rawCode) {
  const code = rawCode.trim();
  const intMatch = code.match(/^(INT[12])(\d{3})$/);
  if (intMatch) {
    return {
      teamCode: intMatch[1],
      teamIndex: Number(intMatch[2])
    };
  }

  const match = code.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;

  return {
    teamCode: normalizeTeamCode(match[1]),
    teamIndex: Number(match[2])
  };
}

function parseScore(value) {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid score value "${value}"`);
  }
  return Number(trimmed);
}

function keyFor(teamCode, teamIndex, problemId) {
  return `${teamCode}-${teamIndex}-P${problemId}`;
}

function labelFor(teamCode, teamIndex, problemId) {
  return `${teamCode}${String(teamIndex).padStart(3, "0")},P${problemId}`;
}

function teamProblemKey(teamCode, problemId) {
  return `${teamCode}-P${problemId}`;
}

function teamProblemLabel(teamCode, problemId) {
  return `${teamCode},P${problemId}`;
}

function readCsvScores() {
  const text = fs.readFileSync(CSV_PATH, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter(line => line.length > 0);
  const header = parseCsvLine(lines[0]);
  const problemColumns = PROBLEMS.map(problem => {
    const index = header.indexOf(`P${problem}`);
    if (index === -1) throw new Error(`Missing P${problem} column in ${CSV_PATH}`);
    return { problem, index };
  });

  const rows = [];
  const scoresByKey = new Map();

  for (const [lineIndex, line] of lines.slice(1).entries()) {
    const cells = parseCsvLine(line);
    const rawCode = cells[1]?.trim() || "";
    if (!rawCode) continue;

    const parsed = parsePaperCode(rawCode);
    if (!parsed) {
      throw new Error(`Could not parse paper code "${rawCode}" on CSV line ${lineIndex + 2}`);
    }

    for (const { problem, index } of problemColumns) {
      const csvScore = parseScore(cells[index] || "");
      const key = keyFor(parsed.teamCode, parsed.teamIndex, problem);
      rows.push({
        key,
        rawCode,
        teamCode: parsed.teamCode,
        teamIndex: parsed.teamIndex,
        problemId: problem,
        csvScore
      });
      scoresByKey.set(key, csvScore);
    }
  }

  return { rows, scoresByKey };
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

async function fetchDbScores() {
  const rows = [];
  const fields = "team_name,team_code,team_index,problem_id,agreed_score,updated_at";
  const endpoint = [
    "/rest/v1/paper_status",
    `?select=${fields}`,
    "&order=team_code.asc,team_index.asc,problem_id.asc"
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

  return rows.map(row => ({
    key: keyFor(row.team_code, Number(row.team_index), Number(row.problem_id)),
    teamName: row.team_name,
    teamCode: row.team_code,
    teamIndex: Number(row.team_index),
    problemId: Number(row.problem_id),
    dbScore: row.agreed_score == null ? null : Number(row.agreed_score),
    updatedAt: row.updated_at || ""
  }));
}

function scoreText(score) {
  return score == null ? "" : String(score);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath, rows, columns) {
  const lines = [
    columns.map(column => csvEscape(column.header)).join(","),
    ...rows.map(row => columns.map(column => csvEscape(column.value(row))).join(","))
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function compareScores(csvScores, dbScores) {
  const dbByKey = new Map(dbScores.map(row => [row.key, row]));
  const csvByKey = csvScores.scoresByKey;
  const details = [];

  for (const csvRow of csvScores.rows) {
    const dbRow = dbByKey.get(csvRow.key);
    const dbScore = dbRow?.dbScore ?? null;
    let status = "match";
    if (!dbRow) status = "missing_in_db";
    else if (csvRow.csvScore == null && dbScore != null) status = "csv_blank_db_scored";
    else if (csvRow.csvScore != null && dbScore == null) status = "csv_scored_db_blank";
    else if (csvRow.csvScore !== dbScore) status = "score_mismatch";

    details.push({
      status,
      rawCode: csvRow.rawCode,
      teamName: dbRow?.teamName || "",
      teamCode: csvRow.teamCode,
      teamIndex: csvRow.teamIndex,
      problemId: csvRow.problemId,
      csvScore: csvRow.csvScore,
      dbScore,
      updatedAt: dbRow?.updatedAt || ""
    });
  }

  for (const dbRow of dbScores) {
    if (csvByKey.has(dbRow.key)) continue;
    details.push({
      status: "missing_in_csv",
      rawCode: "",
      teamName: dbRow.teamName,
      teamCode: dbRow.teamCode,
      teamIndex: dbRow.teamIndex,
      problemId: dbRow.problemId,
      csvScore: null,
      dbScore: dbRow.dbScore,
      updatedAt: dbRow.updatedAt
    });
  }

  details.sort((a, b) =>
    a.teamCode.localeCompare(b.teamCode) ||
    a.teamIndex - b.teamIndex ||
    a.problemId - b.problemId ||
    a.status.localeCompare(b.status)
  );

  return details;
}

function summarize(details) {
  const summary = new Map();
  for (const detail of details) {
    summary.set(detail.status, (summary.get(detail.status) || 0) + 1);
  }
  return summary;
}

function problemSummary(details) {
  const rows = [];
  for (const problemId of PROBLEMS) {
    const subset = details.filter(detail => detail.problemId === problemId);
    rows.push({
      problemId,
      total: subset.length,
      match: subset.filter(detail => detail.status === "match").length,
      differences: subset.filter(detail => detail.status !== "match").length
    });
  }
  return rows;
}

function writeReport(details, dbScores) {
  const generatedAt = new Date().toISOString();
  const summary = summarize(details);
  const differences = details.filter(detail => detail.status !== "match");
  const mismatches = details.filter(detail => detail.status === "score_mismatch");
  const csvScoredDbBlank = details.filter(detail => detail.status === "csv_scored_db_blank");
  const csvBlankDbScored = details.filter(detail => detail.status === "csv_blank_db_scored");
  const missingInCsv = details.filter(detail => detail.status === "missing_in_csv");
  const missingInDb = details.filter(detail => detail.status === "missing_in_db");
  const dbCoordinated = dbScores.filter(row => row.dbScore != null).length;

  const lines = [
    "# Scores Difference Report",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Summary",
    "",
    `- CSV paper-score cells compared: ${details.length - missingInCsv.length}`,
    `- DB paper-score rows fetched: ${dbScores.length}`,
    `- DB coordinated scores: ${dbCoordinated}`,
    `- Matching cells: ${summary.get("match") || 0}`,
    `- Difference cells: ${differences.length}`,
    `- Score mismatches: ${mismatches.length}`,
    `- CSV scored but DB blank: ${csvScoredDbBlank.length}`,
    `- CSV blank but DB scored: ${csvBlankDbScored.length}`,
    `- Present in DB but missing in CSV: ${missingInCsv.length}`,
    `- Present in CSV but missing in DB: ${missingInDb.length}`,
    "",
    "## Differences By Problem",
    "",
    "| Problem | Total | Matches | Differences |",
    "| --- | ---: | ---: | ---: |",
    ...problemSummary(details).map(row => `| P${row.problemId} | ${row.total} | ${row.match} | ${row.differences} |`),
    "",
    "## Difference Rows",
    "",
    "Full machine-readable detail is in `tmp/scores-diff.csv`.",
    ""
  ];

  if (differences.length) {
    lines.push("| Status | Paper | Team | CSV | DB |");
    lines.push("| --- | --- | --- | ---: | ---: |");
    for (const detail of differences) {
      lines.push([
        "|",
        detail.status,
        "|",
        labelFor(detail.teamCode, detail.teamIndex, detail.problemId),
        "|",
        detail.teamName || detail.rawCode || "",
        "|",
        scoreText(detail.csvScore),
        "|",
        scoreText(detail.dbScore),
        "|"
      ].join(" "));
    }
  } else {
    lines.push("No differences found.");
  }

  fs.writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`);
}

function writeDetails(details, dbScores) {
  writeCsv(DETAIL_PATH, details, [
    { header: "status", value: row => row.status },
    { header: "paper", value: row => labelFor(row.teamCode, row.teamIndex, row.problemId) },
    { header: "raw_csv_code", value: row => row.rawCode },
    { header: "team_name", value: row => row.teamName },
    { header: "team_code", value: row => row.teamCode },
    { header: "team_index", value: row => row.teamIndex },
    { header: "problem_id", value: row => row.problemId },
    { header: "csv_score", value: row => scoreText(row.csvScore) },
    { header: "db_agreed_score", value: row => scoreText(row.dbScore) },
    { header: "db_updated_at", value: row => row.updatedAt }
  ]);

  writeCsv(DB_SNAPSHOT_PATH, dbScores, [
    { header: "paper", value: row => labelFor(row.teamCode, row.teamIndex, row.problemId) },
    { header: "team_name", value: row => row.teamName },
    { header: "team_code", value: row => row.teamCode },
    { header: "team_index", value: row => row.teamIndex },
    { header: "problem_id", value: row => row.problemId },
    { header: "db_agreed_score", value: row => scoreText(row.dbScore) },
    { header: "db_updated_at", value: row => row.updatedAt }
  ]);
}

function buildTeamProblemRows(csvScores, dbScores, paperDetails) {
  const dbByKey = new Map(dbScores.map(row => [row.key, row]));
  const csvGroups = new Map();
  const dbGroups = new Map();

  for (const row of csvScores.rows) {
    const key = teamProblemKey(row.teamCode, row.problemId);
    if (!csvGroups.has(key)) {
      csvGroups.set(key, {
        teamCode: row.teamCode,
        problemId: row.problemId,
        scores: [],
        missingInDb: 0
      });
    }
    const group = csvGroups.get(key);
    group.scores.push(row.csvScore);
    if (!dbByKey.has(row.key)) group.missingInDb += 1;
  }

  for (const row of dbScores) {
    const key = teamProblemKey(row.teamCode, row.problemId);
    if (!dbGroups.has(key)) {
      dbGroups.set(key, {
        teamName: row.teamName,
        teamCode: row.teamCode,
        problemId: row.problemId,
        scores: [],
        missingInCsv: 0
      });
    }
    dbGroups.get(key).scores.push(row.dbScore);
  }

  for (const detail of paperDetails) {
    if (detail.status !== "missing_in_csv") continue;
    const key = teamProblemKey(detail.teamCode, detail.problemId);
    const group = dbGroups.get(key);
    if (group) group.missingInCsv += 1;
  }

  const allKeys = new Set([...csvGroups.keys(), ...dbGroups.keys()]);
  const rows = [...allKeys].map(key => {
    const csvGroup = csvGroups.get(key);
    const dbGroup = dbGroups.get(key);
    const teamCode = csvGroup?.teamCode || dbGroup?.teamCode || "";
    const problemId = csvGroup?.problemId || dbGroup?.problemId || 0;
    const teamName = dbGroup?.teamName || "";
    const csvTotal = csvGroup?.scores.length || 0;
    const dbTotal = dbGroup?.scores.length || 0;
    const csvScored = csvGroup?.scores.filter(score => score != null).length || 0;
    const dbScored = dbGroup?.scores.filter(score => score != null).length || 0;
    const csvCoordinated = csvTotal > 0 && csvScored === csvTotal && (csvGroup?.missingInDb || 0) === 0;
    const dbCoordinated = dbTotal > 0 && dbScored === dbTotal && (dbGroup?.missingInCsv || 0) === 0;
    const paperMismatches = paperDetails.filter(detail =>
      detail.teamCode === teamCode &&
      detail.problemId === problemId &&
      detail.status === "score_mismatch"
    );
    const csvTotalScore = csvGroup?.scores.reduce((sum, score) => sum + (score ?? 0), 0) ?? 0;
    const dbTotalScore = dbGroup?.scores.reduce((sum, score) => sum + (score ?? 0), 0) ?? 0;

    let status = "match_not_coordinated";
    if (csvCoordinated && dbCoordinated && paperMismatches.length === 0) {
      status = "match_coordinated";
    } else if (csvCoordinated && dbCoordinated) {
      status = "both_coordinated_score_mismatch";
    } else if (csvCoordinated && !dbCoordinated) {
      status = "csv_coordinated_online_not";
    } else if (!csvCoordinated && dbCoordinated) {
      status = "online_coordinated_csv_not";
    }

    return {
      status,
      teamCode,
      teamName,
      problemId,
      csvCoordinated,
      onlineCoordinated: dbCoordinated,
      csvScored,
      csvTotal,
      onlineScored: dbScored,
      onlineTotal: dbTotal,
      csvTotalScore,
      onlineTotalScore: dbTotalScore,
      paperMismatchCount: paperMismatches.length,
      paperMismatches: paperMismatches
        .map(detail => `${labelFor(detail.teamCode, detail.teamIndex, detail.problemId)} ${scoreText(detail.csvScore)}->${scoreText(detail.dbScore)}`)
        .join("; ")
    };
  });

  rows.sort((a, b) =>
    a.teamCode.localeCompare(b.teamCode) ||
    a.problemId - b.problemId
  );
  return rows;
}

function summarizeTeamProblemRows(rows) {
  const summary = new Map();
  for (const row of rows) {
    summary.set(row.status, (summary.get(row.status) || 0) + 1);
  }
  return summary;
}

function writeTeamProblemDetails(rows) {
  writeCsv(TEAM_PROBLEM_DETAIL_PATH, rows, [
    { header: "status", value: row => row.status },
    { header: "team_problem", value: row => teamProblemLabel(row.teamCode, row.problemId) },
    { header: "team_name", value: row => row.teamName },
    { header: "team_code", value: row => row.teamCode },
    { header: "problem_id", value: row => row.problemId },
    { header: "csv_coordinated", value: row => row.csvCoordinated ? "true" : "false" },
    { header: "online_coordinated", value: row => row.onlineCoordinated ? "true" : "false" },
    { header: "csv_scored", value: row => row.csvScored },
    { header: "csv_total", value: row => row.csvTotal },
    { header: "online_scored", value: row => row.onlineScored },
    { header: "online_total", value: row => row.onlineTotal },
    { header: "csv_total_score", value: row => row.csvTotalScore },
    { header: "online_total_score", value: row => row.onlineTotalScore },
    { header: "paper_mismatch_count", value: row => row.paperMismatchCount },
    { header: "paper_mismatches", value: row => row.paperMismatches }
  ]);
}

function writeTeamProblemReport(rows) {
  const generatedAt = new Date().toISOString();
  const summary = summarizeTeamProblemRows(rows);
  const differences = rows.filter(row =>
    row.status === "csv_coordinated_online_not" ||
    row.status === "online_coordinated_csv_not" ||
    row.status === "both_coordinated_score_mismatch"
  );
  const statusDifferences = rows.filter(row =>
    row.status === "csv_coordinated_online_not" ||
    row.status === "online_coordinated_csv_not"
  );
  const scoreDifferences = rows.filter(row => row.status === "both_coordinated_score_mismatch");

  const lines = [
    "# Team-Problem Difference Report",
    "",
    `Generated: ${generatedAt}`,
    "",
    "A team-problem is coordinated when every paper for that team/problem is scored.",
    "",
    "## Summary",
    "",
    `- Team-problem pairs compared: ${rows.length}`,
    `- Coordinated in both with matching paper scores: ${summary.get("match_coordinated") || 0}`,
    `- Uncoordinated in both: ${summary.get("match_not_coordinated") || 0}`,
    `- Coordination-status differences: ${statusDifferences.length}`,
    `- Coordinated in CSV but not online: ${summary.get("csv_coordinated_online_not") || 0}`,
    `- Coordinated online but not CSV: ${summary.get("online_coordinated_csv_not") || 0}`,
    `- Coordinated in both but score mismatch: ${scoreDifferences.length}`,
    "",
    "## Differences By Problem",
    "",
    "| Problem | Status differences | Both coordinated score mismatches | Total differences |",
    "| --- | ---: | ---: | ---: |",
    ...PROBLEMS.map(problem => {
      const subset = differences.filter(row => row.problemId === problem);
      const statusCount = subset.filter(row => row.status !== "both_coordinated_score_mismatch").length;
      const scoreCount = subset.filter(row => row.status === "both_coordinated_score_mismatch").length;
      return `| P${problem} | ${statusCount} | ${scoreCount} | ${subset.length} |`;
    }),
    "",
    "## Difference Rows",
    "",
    "Full machine-readable detail is in `tmp/team-problem-diff.csv`.",
    ""
  ];

  if (differences.length) {
    lines.push("| Status | Team Problem | Team | CSV | Online | CSV Total | Online Total | Paper Mismatches |");
    lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | --- |");
    for (const row of differences) {
      lines.push([
        "|",
        row.status,
        "|",
        teamProblemLabel(row.teamCode, row.problemId),
        "|",
        row.teamName,
        "|",
        `${row.csvScored}/${row.csvTotal}`,
        "|",
        `${row.onlineScored}/${row.onlineTotal}`,
        "|",
        row.csvCoordinated ? row.csvTotalScore : "",
        "|",
        row.onlineCoordinated ? row.onlineTotalScore : "",
        "|",
        row.paperMismatches,
        "|"
      ].join(" "));
    }
  } else {
    lines.push("No team-problem differences found.");
  }

  fs.writeFileSync(TEAM_PROBLEM_REPORT_PATH, `${lines.join("\n")}\n`);
}

const csvScores = readCsvScores();
const dbScores = await fetchDbScores();
const details = compareScores(csvScores, dbScores);
const teamProblemRows = buildTeamProblemRows(csvScores, dbScores, details);
writeDetails(details, dbScores);
writeReport(details, dbScores);
writeTeamProblemDetails(teamProblemRows);
writeTeamProblemReport(teamProblemRows);

const summary = summarize(details);
const teamProblemSummary = summarizeTeamProblemRows(teamProblemRows);
console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)}`);
console.log(`Wrote ${path.relative(ROOT, DETAIL_PATH)}`);
console.log(`Wrote ${path.relative(ROOT, DB_SNAPSHOT_PATH)}`);
console.log(`Wrote ${path.relative(ROOT, TEAM_PROBLEM_REPORT_PATH)}`);
console.log(`Wrote ${path.relative(ROOT, TEAM_PROBLEM_DETAIL_PATH)}`);
console.log(`Matches: ${summary.get("match") || 0}`);
console.log(`Differences: ${details.filter(detail => detail.status !== "match").length}`);
console.log(`Team-problem coordination-status differences: ${(teamProblemSummary.get("csv_coordinated_online_not") || 0) + (teamProblemSummary.get("online_coordinated_csv_not") || 0)}`);
console.log(`Team-problem score mismatches where both coordinated: ${teamProblemSummary.get("both_coordinated_score_mismatch") || 0}`);
