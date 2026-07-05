import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SCAN_DIR = path.join(process.env.HOME || "", "Downloads", "Day1_Scan");
const BUCKET = process.env.PAPER_PDF_BUCKET || "paper-pdfs";
const SCAN_DIR_ARG = process.argv.slice(2).find(arg => !arg.startsWith("--"));
const SCAN_DIR = path.resolve(SCAN_DIR_ARG || process.env.DAY1_SCAN_DIR || DEFAULT_SCAN_DIR);
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";

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

function findPaperPdfs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findPaperPdfs(fullPath));
    } else if (entry.isFile() && /^p\d\.pdf$/i.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function parsePaperPath(filePath) {
  const relativePath = path.relative(SCAN_DIR, filePath);
  const parts = relativePath.split(path.sep);
  const studentMatch = parts[1]?.match(/^0*(\d+)$/);
  const problemMatch = parts[2]?.match(/^p(\d)\.pdf$/i);
  if (parts.length !== 3 || !studentMatch || !problemMatch) {
    throw new Error(`Unexpected PDF path shape: ${filePath}`);
  }

  const teamCode = parts[0];
  const teamIndex = Number(studentMatch[1]);
  const problemId = Number(problemMatch[1]);
  const storagePath = `day1/${teamCode}/${String(teamIndex).padStart(3, "0")}/p${problemId}.pdf`;
  return {
    teamCode,
    teamIndex,
    problemId,
    key: `${teamCode}:${teamIndex}:${problemId}`,
    storagePath,
    originalName: path.basename(filePath),
    filePath
  };
}

function storageObjectUrl(bucket, objectPath) {
  return `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/")}`;
}

async function supabaseFetch(endpoint, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      ...(options.body && !(options.body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${endpoint} failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function fetchPaperRows() {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const endpoint = [
      "/rest/v1/paper_status",
      "?select=paper_id,team_code,team_index,problem_id,pdf_path",
      "&order=team_code.asc,team_index.asc,problem_id.asc"
    ].join("");
    const batch = await supabaseFetch(endpoint, {
      method: "GET",
      headers: {
        Range: `${from}-${from + pageSize - 1}`
      }
    });
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function ensureBucket() {
  const bucketEndpoint = `/storage/v1/bucket/${encodeURIComponent(BUCKET)}`;
  try {
    await supabaseFetch(bucketEndpoint, { method: "GET" });
    return;
  } catch (error) {
    if (!/failed: 404\b/.test(error.message)) throw error;
  }

  await supabaseFetch("/storage/v1/bucket", {
    method: "POST",
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: 52428800,
      allowed_mime_types: ["application/pdf"]
    })
  });
}

async function uploadFile(item) {
  const bytes = fs.readFileSync(item.filePath);
  const response = await fetch(storageObjectUrl(BUCKET, item.storagePath), {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/pdf",
      "x-upsert": "true"
    },
    body: bytes
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Upload ${item.storagePath} failed: ${response.status} ${text}`);
  }
}

async function attachPaper(paperId, item, sizeBytes) {
  await supabaseFetch(`/rest/v1/papers?id=eq.${encodeURIComponent(paperId)}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      pdf_bucket: BUCKET,
      pdf_path: item.storagePath,
      pdf_original_name: item.originalName,
      pdf_size_bytes: sizeBytes,
      pdf_uploaded_at: new Date().toISOString()
    })
  });
}

async function main() {
  if (!fs.existsSync(SCAN_DIR)) {
    throw new Error(`Scan directory does not exist: ${SCAN_DIR}`);
  }

  const pdfs = findPaperPdfs(SCAN_DIR).map(parsePaperPath);
  const duplicateKeys = [...pdfs.reduce((map, item) => {
    map.set(item.key, (map.get(item.key) || 0) + 1);
    return map;
  }, new Map()).entries()].filter(([, count]) => count > 1);
  if (duplicateKeys.length) {
    throw new Error(`Duplicate local paper keys:\n${duplicateKeys.map(([key, count]) => `${key} count=${count}`).join("\n")}`);
  }

  const paperRows = await fetchPaperRows();
  const paperByKey = new Map(paperRows.map(row => [
    `${row.team_code}:${Number(row.team_index)}:${Number(row.problem_id)}`,
    row
  ]));

  const missing = pdfs.filter(item => !paperByKey.has(item.key));
  if (missing.length) {
    throw new Error(`Local PDFs without matching DB paper:\n${missing.map(item => item.storagePath).join("\n")}`);
  }

  const totalBytes = pdfs.reduce((sum, item) => sum + fs.statSync(item.filePath).size, 0);
  console.log(`Scan dir: ${SCAN_DIR}`);
  console.log(`PDFs to attach: ${pdfs.length}`);
  console.log(`Total size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Bucket: ${BUCKET}`);

  if (DRY_RUN) {
    console.log("Dry run only; no uploads or DB updates performed.");
    return;
  }

  await ensureBucket();

  let uploaded = 0;
  for (const item of pdfs) {
    const paper = paperByKey.get(item.key);
    const sizeBytes = fs.statSync(item.filePath).size;
    await uploadFile(item);
    await attachPaper(paper.paper_id, item, sizeBytes);
    uploaded += 1;
    if (uploaded % 25 === 0 || uploaded === pdfs.length) {
      console.log(`Attached ${uploaded}/${pdfs.length}`);
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
