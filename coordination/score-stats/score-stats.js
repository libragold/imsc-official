import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dom = {
  configWarning: document.querySelector("#configWarning"),
  loadingView: document.querySelector("#loadingView"),
  scoreStatsSection: document.querySelector("#scoreStatsSection"),
  scoreStatsView: document.querySelector("#scoreStatsView"),
  scoreStatsCompleteness: document.querySelector("#scoreStatsCompleteness"),
  userMenu: document.querySelector("#userMenu"),
  avatarButton: document.querySelector("#avatarButton"),
  avatarMenu: document.querySelector("#avatarMenu"),
  signOutButton: document.querySelector("#signOutButton")
};

const config = window.COORDINATION_SUPABASE_CONFIG;
const PROBLEMS = [1, 2, 3, 4, 5, 6];
const activeView = document.body.dataset.scoreStatsView || "individual";
const individualCutoffs = [10, 18, 24];
let supabase = null;
let currentUser = null;
let currentCoordinator = null;

function configureSupabase() {
  const hasPlaceholder =
    /your-project-ref|YOUR_|sb_publishable_or_anon_key/i.test(config?.url || "") ||
    /your-project-ref|YOUR_|sb_publishable_or_anon_key/i.test(config?.publishableKey || "");

  if (!config?.url || !config?.publishableKey || hasPlaceholder) {
    dom.configWarning.hidden = false;
    dom.loadingView.hidden = true;
    return false;
  }

  supabase = createClient(config.url, config.publishableKey);
  return true;
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
  return slugName(String(name || "").split(/\s+/)[0]).replace(/[^a-z0-9]/g, "") || "coordinator";
}

function avatarSeedForPerson(person) {
  return person?.avatar_seed || firstNameSeed(person?.name || "coordinator");
}

function avatarUrl(seed) {
  return `https://api.dicebear.com/9.x/micah/svg?seed=${encodeURIComponent(seed || "coordinator")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAvatarButton() {
  dom.avatarButton.innerHTML = `
    <img src="${avatarUrl(avatarSeedForPerson(currentCoordinator))}" alt="">
    <span>${escapeHtml(currentCoordinator.name)}</span>
  `;
  dom.avatarButton.setAttribute("aria-label", `Menu for ${currentCoordinator.name}`);
}

async function loadCoordinator() {
  const { data, error } = await supabase
    .from("coordinators")
    .select("id,name,avatar_seed,auth_user_id,active")
    .eq("auth_user_id", currentUser.id)
    .single();

  if (error) throw error;
  currentCoordinator = data;
}

async function loadPaperRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("paper_status")
      .select("team_code,team_name,team_index,problem_id,agreed_score")
      .order("team_code", { ascending: true })
      .order("team_index", { ascending: true })
      .order("problem_id", { ascending: true })
      .range(from, from + 999);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
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
  const clean = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  const count = clean.length;
  if (!count) {
    return { count: 0, mean: null, median: null, min: null, max: null, q1: null, q3: null, stdev: null };
  }

  const sum = clean.reduce((total, value) => total + value, 0);
  const mean = sum / count;
  const variance = clean.reduce((total, value) => total + (value - mean) ** 2, 0) / count;

  return {
    count,
    mean: round(mean),
    median: round(percentile(clean, 0.5)),
    min: clean[0],
    max: clean[count - 1],
    q1: round(percentile(clean, 0.25)),
    q3: round(percentile(clean, 0.75)),
    stdev: round(Math.sqrt(variance))
  };
}

function distribution(values, min, max) {
  const buckets = new Map();
  for (let value = min; value <= max; value += 1) {
    buckets.set(value, 0);
  }
  for (const value of values) {
    buckets.set(value, (buckets.get(value) || 0) + 1);
  }
  return [...buckets.entries()].map(([value, count]) => ({ value, count }));
}

function buildScoreStats(rows) {
  const normalizedRows = rows
    .map(row => ({
      teamCode: row.team_code || row.team_name || "TEAM",
      teamName: row.team_name || row.team_code || "Team",
      teamIndex: Number(row.team_index),
      problemId: Number(row.problem_id),
      score: row.agreed_score == null ? null : Number(row.agreed_score)
    }))
    .filter(row => PROBLEMS.includes(row.problemId));

  const finalizedScores = normalizedRows.filter(row => row.score != null);
  const students = new Map();
  const teams = new Map();

  for (const row of normalizedRows) {
    const studentKey = `${row.teamCode}-${row.teamIndex}`;
    if (!students.has(studentKey)) {
      students.set(studentKey, {
        teamCode: row.teamCode,
        teamIndex: row.teamIndex,
        scores: new Map()
      });
    }
    students.get(studentKey).scores.set(row.problemId, row.score);

    if (!teams.has(row.teamCode)) {
      teams.set(row.teamCode, {
        teamCode: row.teamCode,
        teamName: row.teamName,
        scores: []
      });
    }
    teams.get(row.teamCode).scores.push(row.score);
  }

  const individualTotals = [...students.values()]
    .filter(student => PROBLEMS.every(problem => student.scores.get(problem) != null))
    .map(student => PROBLEMS.reduce((sum, problem) => sum + student.scores.get(problem), 0));

  const completeTeamTotals = [...teams.values()]
    .filter(team => team.scores.length > 0 && team.scores.every(score => score != null))
    .map(team => team.scores.reduce((sum, score) => sum + score, 0));

  const sortedTeamTotals = completeTeamTotals
    .sort((a, b) => b - a)
    .map((total, index, values) => ({
      rank: values.findIndex(value => value === total) + 1,
      position: index + 1,
      total
    }));

  const problemScores = Object.fromEntries(PROBLEMS.map(problem => {
    const scores = finalizedScores
      .filter(row => row.problemId === problem)
      .map(row => row.score);
    return [String(problem), {
      distribution: distribution(scores, 0, 7),
      stats: summarizeValues(scores)
    }];
  }));

  return {
    totalPaperScores: normalizedRows.length,
    finalizedPaperScores: finalizedScores.length,
    completeStudents: individualTotals.length,
    completeTeams: completeTeamTotals.length,
    individualTotals: {
      distribution: distribution(individualTotals, 0, 42),
      stats: summarizeValues(individualTotals)
    },
    teamTotals: {
      ranking: sortedTeamTotals,
      stats: summarizeValues(sortedTeamTotals.map(row => row.total))
    },
    problemScores
  };
}

function formatNumber(value, places = 2) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString([], { maximumFractionDigits: places });
}

function renderSummaryStats(stats) {
  const items = [
    ["N", stats?.count],
    ["Mean", stats?.mean],
    ["Median", stats?.median],
    ["Min", stats?.min],
    ["Max", stats?.max],
    ["Q1-Q3", `${formatNumber(stats?.q1)}-${formatNumber(stats?.q3)}`],
    ["Std", stats?.stdev]
  ];

  return `
    <div class="score-stat-strip">
      ${items.map(([label, value]) => `
        <div class="score-stat">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(typeof value === "string" ? value : formatNumber(value))}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderHistogram(distributionRows, label) {
  const max = Math.max(1, ...distributionRows.map(row => row.count));
  return `
    <div class="score-histogram" style="--bucket-count: ${distributionRows.length}">
      ${distributionRows.map(row => {
        const height = Math.round((row.count / max) * 100);
        return `
          <div
            class="score-histogram-bar${row.count ? "" : " is-empty"}"
            style="--height: ${height}"
            title="${escapeHtml(`${label} ${row.value}: ${row.count}`)}"
          ></div>
        `;
      }).join("")}
    </div>
    <div class="score-axis">
      <span>${escapeHtml(distributionRows[0]?.value ?? "")}</span>
      <span>${escapeHtml(distributionRows.at(-1)?.value ?? "")}</span>
    </div>
  `;
}

function sectionForScore(score) {
  if (score >= individualCutoffs[2]) return "gold";
  if (score >= individualCutoffs[1]) return "silver";
  if (score >= individualCutoffs[0]) return "bronze";
  return "honorable";
}

function individualSectionCounts(distributionRows) {
  return distributionRows.reduce((counts, row) => {
    counts[sectionForScore(row.value)] += row.count;
    return counts;
  }, {
    honorable: 0,
    bronze: 0,
    silver: 0,
    gold: 0
  });
}

function sectionBounds(distributionRows) {
  const bucketCount = distributionRows.length;
  const cutoffs = individualCutoffs;
  return [
    { key: "honorable", label: "Honorable Mention", start: 0, end: cutoffs[0] },
    { key: "bronze", label: "Bronze", start: cutoffs[0], end: cutoffs[1] },
    { key: "silver", label: "Silver", start: cutoffs[1], end: cutoffs[2] },
    { key: "gold", label: "Gold", start: cutoffs[2], end: bucketCount }
  ];
}

function renderLabeledHistogram(distributionRows, label) {
  const max = Math.max(1, ...distributionRows.map(row => row.count));
  const counts = individualSectionCounts(distributionRows);
  const bucketCount = distributionRows.length;
  return `
    <div class="individual-histogram-scroll">
      <div class="individual-histogram" style="--bucket-count: ${distributionRows.length}">
        <div class="individual-sections" aria-live="polite">
          ${sectionBounds(distributionRows).map(section => {
            const left = (section.start / bucketCount) * 100;
            const width = ((section.end - section.start) / bucketCount) * 100;
            return `
              <div
                class="individual-section ${section.key}"
                style="--section-left: ${left}; --section-width: ${width}"
              >
                <span>${escapeHtml(section.label)}</span>
                <strong>${escapeHtml(counts[section.key])}</strong>
              </div>
            `;
          }).join("")}
        </div>
        ${distributionRows.map(row => {
          const height = Math.round((row.count / max) * 100);
          const section = sectionForScore(row.value);
          return `
            <div class="individual-histogram-column ${section}">
              <div class="individual-bar-slot" style="--height: ${height}">
                <div class="individual-frequency">${escapeHtml(row.count)}</div>
                <div
                  class="score-histogram-bar${row.count ? "" : " is-empty"}"
                  title="${escapeHtml(`${label} ${row.value}: ${row.count}`)}"
                ></div>
              </div>
              <div class="individual-score-label">${escapeHtml(row.value)}</div>
            </div>
          `;
        }).join("")}
        ${individualCutoffs.map((cutoff, index) => {
          const left = (cutoff / bucketCount) * 100;
          return `
            <button
              class="individual-cutoff-handle"
              type="button"
              style="--cutoff-left: ${left}"
              data-cutoff-index="${index}"
              aria-label="${escapeHtml(`Move cutoff ${index + 1}, currently before score ${cutoff}`)}"
            >
              <span>${escapeHtml(cutoff)}+</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function bindIndividualCutoffs(distributionRows) {
  const histogram = document.querySelector(".individual-histogram");
  if (!histogram) return;
  const bucketCount = distributionRows.length;
  const handles = [...histogram.querySelectorAll(".individual-cutoff-handle")];

  function cutoffFromPointer(event) {
    const rect = histogram.getBoundingClientRect();
    if (!rect.width) return individualCutoffs[0];
    const ratio = (event.clientX - rect.left) / rect.width;
    return Math.max(1, Math.min(bucketCount - 1, Math.round(ratio * bucketCount)));
  }

  function clampCutoff(index, value) {
    const min = index === 0 ? 1 : individualCutoffs[index - 1] + 1;
    const max = index === individualCutoffs.length - 1
      ? bucketCount - 1
      : individualCutoffs[index + 1] - 1;
    return Math.max(min, Math.min(max, value));
  }

  function moveHandle(index, value) {
    const next = clampCutoff(index, value);
    if (next === individualCutoffs[index]) return;
    individualCutoffs[index] = next;
    updateIndividualHistogram(histogram, distributionRows);
  }

  for (const handle of handles) {
    handle.addEventListener("pointerdown", event => {
      event.preventDefault();
      const index = Number(handle.dataset.cutoffIndex);
      handle.classList.add("is-dragging");

      const onPointerMove = moveEvent => {
        moveHandle(index, cutoffFromPointer(moveEvent));
      };

      const onPointerUp = () => {
        handle.classList.remove("is-dragging");
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    });
  }
}

function updateIndividualHistogram(histogram, distributionRows) {
  const bucketCount = distributionRows.length;
  const counts = individualSectionCounts(distributionRows);

  for (const section of sectionBounds(distributionRows)) {
    const element = histogram.querySelector(`.individual-section.${section.key}`);
    if (!element) continue;
    element.style.setProperty("--section-left", (section.start / bucketCount) * 100);
    element.style.setProperty("--section-width", ((section.end - section.start) / bucketCount) * 100);
    const countElement = element.querySelector("strong");
    if (countElement) countElement.textContent = counts[section.key];
  }

  const columns = [...histogram.querySelectorAll(".individual-histogram-column")];
  distributionRows.forEach((row, index) => {
    const column = columns[index];
    if (!column) return;
    column.classList.remove("honorable", "bronze", "silver", "gold");
    column.classList.add(sectionForScore(row.value));
  });

  const handles = [...histogram.querySelectorAll(".individual-cutoff-handle")];
  handles.forEach((handle, index) => {
    const cutoff = individualCutoffs[index];
    handle.style.setProperty("--cutoff-left", (cutoff / bucketCount) * 100);
    handle.setAttribute("aria-label", `Move cutoff ${index + 1}, currently before score ${cutoff}`);
    const label = handle.querySelector("span");
    if (label) label.textContent = `${cutoff}+`;
  });
}

function renderIndividualDistribution(scoreStats) {
  return `
    <article class="score-panel score-panel-wide individual-score-panel">
      <div class="score-panel-header">
        <h3>Individual Totals</h3>
        <span>${scoreStats.completeStudents} complete students</span>
      </div>
      ${renderSummaryStats(scoreStats.individualTotals.stats)}
      <div class="score-chart-pad">
        ${renderLabeledHistogram(scoreStats.individualTotals.distribution, "Total")}
      </div>
    </article>
  `;
}

function renderTeamTotals(scoreStats) {
  const rows = scoreStats.teamTotals.ranking;
  const max = Math.max(1, ...rows.map(row => row.total));
  return `
    <article class="score-panel team-total-panel">
      <div class="score-panel-header">
        <h3>Anonymous Team Totals</h3>
        <span>${scoreStats.completeTeams} complete teams</span>
      </div>
      ${renderSummaryStats(scoreStats.teamTotals.stats)}
      <div class="anonymous-team-ranking">
        ${rows.map(row => {
          const width = Math.round((row.total / max) * 100);
          return `
            <div class="anonymous-team-row">
              <span>#${escapeHtml(row.rank)}</span>
              <div class="anonymous-track" aria-hidden="true">
                <div class="anonymous-fill" style="--width: ${width}"></div>
              </div>
              <strong>${escapeHtml(row.total)}</strong>
            </div>
          `;
        }).join("")}
      </div>
    </article>
  `;
}

function renderProblemDistribution(problem, details) {
  const distributionRows = details.distribution;
  const max = Math.max(1, ...distributionRows.map(row => row.count));
  return `
    <article class="problem-score-panel">
      <div class="score-panel-header">
        <h3>P${escapeHtml(problem)}</h3>
        <span>Mean ${escapeHtml(formatNumber(details.stats.mean))}</span>
      </div>
      <div class="problem-score-bars">
        ${distributionRows.map(row => {
          const width = Math.round((row.count / max) * 100);
          return `
            <div class="problem-score-row">
              <span>${escapeHtml(row.value)}</span>
              <div class="problem-score-track" title="${escapeHtml(`${row.count} scores at ${row.value}`)}">
                <div class="problem-score-fill" style="--width: ${width}"></div>
              </div>
              <strong>${escapeHtml(row.count)}</strong>
            </div>
          `;
        }).join("")}
      </div>
      ${renderSummaryStats(details.stats)}
    </article>
  `;
}

function renderScoreStats(scoreStats) {
  dom.scoreStatsCompleteness.textContent = `${scoreStats.finalizedPaperScores}/${scoreStats.totalPaperScores} finalized`;
  if (activeView === "team-totals") {
    dom.scoreStatsView.classList.add("score-stats-grid-centered");
    dom.scoreStatsView.innerHTML = renderTeamTotals(scoreStats);
    return;
  }

  if (activeView === "problems") {
    dom.scoreStatsView.innerHTML = `
      <section class="score-panel score-panel-wide">
        <div class="score-panel-header">
          <h3>Problem Score Distributions</h3>
          <span>Finalized scores only</span>
        </div>
        <div class="problem-score-grid">
          ${Object.entries(scoreStats.problemScores)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([problem, details]) => renderProblemDistribution(problem, details))
            .join("")}
        </div>
      </section>
    `;
    return;
  }

  dom.scoreStatsView.innerHTML = renderIndividualDistribution(scoreStats);
  bindIndividualCutoffs(scoreStats.individualTotals.distribution);
}

function bindEvents() {
  dom.avatarButton.addEventListener("click", () => {
    const nextHidden = !dom.avatarMenu.hidden;
    dom.avatarMenu.hidden = nextHidden;
    dom.avatarButton.setAttribute("aria-expanded", String(!nextHidden));
  });

  dom.signOutButton.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.replace("/coordination/");
  });

  document.addEventListener("click", event => {
    if (!dom.userMenu.hidden && !event.target.closest("#userMenu")) {
      dom.avatarMenu.hidden = true;
      dom.avatarButton.setAttribute("aria-expanded", "false");
    }
  });
}

async function init() {
  if (!configureSupabase()) return;
  bindEvents();

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    currentUser = data.session?.user || null;

    if (!currentUser) {
      window.location.replace("/coordination/");
      return;
    }

    await loadCoordinator();
    const rows = await loadPaperRows();
    renderAvatarButton();
    renderScoreStats(buildScoreStats(rows));
    dom.userMenu.hidden = false;
    dom.loadingView.hidden = true;
    dom.scoreStatsSection.hidden = false;
  } catch (error) {
    dom.loadingView.classList.add("danger");
    dom.loadingView.textContent = error.message;
  }
}

void init();
