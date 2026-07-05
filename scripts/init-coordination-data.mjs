import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EMAIL_DOMAIN = "imsc-coordination.local";
const REMOVED_COORDINATORS = new Set(["Alex Song", "Sari Ghanem"]);
const EXTRA_TEAMS = [
  "China",
  "China Inner Mongolia",
  "China Beijing"
];
const REMOVED_TEAMS = [
  "China Inner Mongolia 1",
  "China Hubei Wuhan"
];
const RENAMED_TEAMS = new Map([
  ["China Hubei Wuhan", "China Hubei"]
]);
const TEAM_CODES = new Map([
  ["Albania", "ALB"],
  ["Bangladesh", "BGD"],
  ["Bosnia & Herzegovina", "BIH"],
  ["Botswana", "BWA"],
  ["Brazil", "BRA"],
  ["Cameroon", "CMR"],
  ["China", "CHN"],
  ["China Beijing", "BJ"],
  ["China Hubei", "CHB"],
  ["China Inner Mongolia", "NMG"],
  ["Costa Rica", "CRI"],
  ["Croatia", "CRO"],
  ["Cuba", "CUB"],
  ["Czechia", "CZE"],
  ["Estonia", "EST"],
  ["Ghana", "GHA"],
  ["Honduras", "HND"],
  ["Hong Kong China", "HKG"],
  ["Iceland", "ISL"],
  ["Indonesia", "IDN"],
  ["International Union I", "INT1"],
  ["International Union II", "INT2"],
  ["Iran", "IRN"],
  ["Ireland", "IRL"],
  ["Italy", "ITA"],
  ["Kyrgyzstan", "KGZ"],
  ["Lithuania", "LTU"],
  ["Macau China", "MAC"],
  ["Malaysia", "MAS"],
  ["Mexico", "MEX"],
  ["Moldova", "MDA"],
  ["Mongolia", "MNG"],
  ["Montenegro", "MNE"],
  ["Myanmar", "MMR"],
  ["Nepal", "NPL"],
  ["North Macedonia", "MKD"],
  ["Pakistan", "PAK"],
  ["Peru", "PER"],
  ["Poland", "POL"],
  ["Rwanda", "RWA"],
  ["Serbia", "SRB"],
  ["South Africa", "ZAF"],
  ["Tajikistan", "TJK"],
  ["Thailand", "THA"],
  ["Turkmenistan", "TKM"],
  ["Uganda", "UGA"],
  ["Uruguay", "URY"],
  ["Uzbekistan", "UZB"],
  ["Vietnam", "VNM"]
]);
const TEAM_STUDENT_COUNTS = new Map([
  ["China", 6],
  ["China Beijing", 6],
  ["China Inner Mongolia", 6],
  ["Hong Kong China", 4],
  ["International Union I", 5],
  ["International Union II", 5],
  ["Montenegro", 5],
  ["North Macedonia", 5],
  ["Uganda", 2]
]);
const TEAM_STUDENT_INDEXES = new Map([
  ["China Inner Mongolia", [1, 2, 3, 5, 6, 7]]
]);
const DEFAULT_STUDENT_COUNT = 6;

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
const PASSWORD_OUTPUT = process.env.COORDINATION_PASSWORD_OUTPUT || "coordination-passwords.csv";
const RESET_PASSWORDS = process.env.COORDINATION_RESET_PASSWORDS === "true";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

function slugName(name) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function firstNameSeed(name) {
  return slugName(name.split(/\s+/)[0]).replace(/[^a-z0-9]/g, "") || "coordinator";
}

function authEmailForName(name) {
  return `${slugName(name)}@${EMAIL_DOMAIN}`;
}

function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  while (out.length < 8) {
    const byte = crypto.randomBytes(1)[0];
    if (byte >= alphabet.length * 4) continue;
    out += alphabet[byte % alphabet.length];
  }
  return out;
}

function extractTeamsAndCoordinators() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const teamMatch = html.match(/const TEAM_ORDER = (\[[\s\S]*?\]);/);
  if (!teamMatch) throw new Error("Could not find TEAM_ORDER in index.html");
  const teams = JSON.parse(teamMatch[1]);

  const groupMatch = html.match(/const GROUPS = \{([\s\S]*?)\n    \};/);
  if (!groupMatch) throw new Error("Could not find GROUPS in index.html");
  const coordinatorNames = [...groupMatch[1].matchAll(/homeroom: "([^"]+)"/g)]
    .flatMap(match => match[1].split(" / "))
    .map(name => name.trim())
    .filter(name => name && !REMOVED_COORDINATORS.has(name));

  return {
    teams: [...new Set([...teams, ...EXTRA_TEAMS])].sort((a, b) => a.localeCompare(b)),
    coordinators: [...new Set(coordinatorNames)].sort((a, b) => a.localeCompare(b))
  };
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

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${options.method || "GET"} ${endpoint} failed: ${response.status} ${body}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function listAuthUsers() {
  const data = await supabaseFetch("/auth/v1/admin/users?page=1&per_page=1000", {
    method: "GET"
  });
  return data.users || [];
}

async function upsertAuthUser(name, password, existingUsers) {
  const email = authEmailForName(name);
  const existing = existingUsers.find(user => user.email?.toLowerCase() === email.toLowerCase());
  const attributes = {
    email,
    email_confirm: true,
    user_metadata: { name, role: "coordinator" }
  };

  if (existing) {
    if (!RESET_PASSWORDS) return { user: existing, password: "" };
    const updated = await supabaseFetch(`/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...attributes, password })
    });
    return { user: updated.user || updated, password };
  }

  const created = await supabaseFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ ...attributes, password })
  });
  return { user: created.user || created, password };
}

async function upsertRows(table, rows, onConflict) {
  if (!rows.length) return [];
  return supabaseFetch(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(rows)
  });
}

async function selectRows(table, query = "") {
  return supabaseFetch(`/rest/v1/${table}${query}`, {
    method: "GET"
  });
}

async function deleteRows(table, query = "") {
  return supabaseFetch(`/rest/v1/${table}${query}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal"
    }
  });
}

async function updateRows(table, query = "", row) {
  return supabaseFetch(`/rest/v1/${table}${query}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  });
}

function studentIndexesForTeam(teamName) {
  const customIndexes = TEAM_STUDENT_INDEXES.get(teamName);
  if (customIndexes) return customIndexes;
  const count = TEAM_STUDENT_COUNTS.get(teamName) || DEFAULT_STUDENT_COUNT;
  return Array.from({ length: count }, (_, index) => index + 1);
}

function teamCodeForName(teamName) {
  return TEAM_CODES.get(teamName) || null;
}

async function deleteRemovedTeams() {
  for (const teamName of REMOVED_TEAMS) {
    await deleteRows("teams", `?name=eq.${encodeURIComponent(teamName)}`);
  }
}

async function renameTeams() {
  for (const [oldName, newName] of RENAMED_TEAMS) {
    const existingNew = await selectRows("teams", `?select=id&name=eq.${encodeURIComponent(newName)}`);
    if (existingNew.length) continue;
    await updateRows("teams", `?name=eq.${encodeURIComponent(oldName)}`, {
      name: newName,
      code: teamCodeForName(newName)
    });
  }
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (!/[",\n]/.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

async function main() {
  const { teams, coordinators } = extractTeamsAndCoordinators();
  const existingUsers = await listAuthUsers();

  const passwordRows = [];
  const coordinatorRows = [];
  for (const name of coordinators) {
    const password = randomPassword();
    const { user, password: issuedPassword } = await upsertAuthUser(name, password, existingUsers);
    coordinatorRows.push({
      auth_user_id: user.id,
      name,
      avatar_seed: firstNameSeed(name),
      active: true
    });
    passwordRows.push({
      name,
      email: authEmailForName(name),
      password: issuedPassword || "UNCHANGED"
    });
  }

  await upsertRows("coordinators", coordinatorRows, "name");
  await renameTeams();
  await upsertRows("teams", teams.map(name => ({ name, code: teamCodeForName(name) })), "name");
  await deleteRemovedTeams();

  const teamRows = await selectRows("teams", "?select=id,name");
  const students = teamRows.flatMap(team =>
    studentIndexesForTeam(team.name).map(teamIndex => ({
      team_id: team.id,
      team_index: teamIndex,
      name: `Student ${teamIndex}`
    }))
  );
  await upsertRows("students", students, "team_id,team_index");

  for (const team of teamRows) {
    const indexes = studentIndexesForTeam(team.name);
    await deleteRows("students", `?team_id=eq.${team.id}&team_index=not.in.(${indexes.join(",")})`);
  }

  const studentRows = await selectRows("students", "?select=id");
  const papers = studentRows.flatMap(student =>
    Array.from({ length: 6 }, (_, index) => ({
      student_id: student.id,
      problem_id: index + 1
    }))
  );
  await upsertRows("papers", papers, "student_id,problem_id");

  const csv = [
    "name,email,password",
    ...passwordRows.map(row => [row.name, row.email, row.password].map(csvEscape).join(","))
  ].join("\n");
  fs.writeFileSync(path.join(ROOT, PASSWORD_OUTPUT), `${csv}\n`);

  console.log(`Seeded ${coordinators.length} coordinators, ${teams.length} teams, ${students.length} students, and ${papers.length} papers.`);
  console.log(`Wrote passwords to ${PASSWORD_OUTPUT}. This file is ignored by Git.`);
  if (!RESET_PASSWORDS) console.log("Existing auth user passwords were left unchanged. Set COORDINATION_RESET_PASSWORDS=true to regenerate them.");
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
