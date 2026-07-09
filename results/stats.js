const data = window.IMSC_STATS_DATA || {};
const individualCutoffs = [10, 18, 24];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString([], { maximumFractionDigits: 2 });
}

function formatSnapshotTime(value) {
  if (!value) return "Last updated: not generated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Last updated";
  return `Last updated ${date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
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
  }, { honorable: 0, bronze: 0, silver: 0, gold: 0 });
}

function sectionBounds(distributionRows) {
  const bucketCount = distributionRows.length;
  return [
    { key: "honorable", label: "Others", start: 0, end: individualCutoffs[0] },
    { key: "bronze", label: "Bronze", start: individualCutoffs[0], end: individualCutoffs[1] },
    { key: "silver", label: "Silver", start: individualCutoffs[1], end: individualCutoffs[2] },
    { key: "gold", label: "Gold", start: individualCutoffs[2], end: bucketCount }
  ];
}

function renderIndividualHistogram(distributionRows) {
  const max = Math.max(1, ...distributionRows.map(row => row.count));
  const counts = individualSectionCounts(distributionRows);
  const bucketCount = distributionRows.length;
  return `
    <div class="individual-histogram-scroll">
      <div class="individual-histogram" style="--bucket-count: ${bucketCount}">
        <div class="individual-sections" aria-live="polite">
          ${sectionBounds(distributionRows).map(section => `
            <div
              class="individual-section ${section.key}"
              style="--section-left: ${(section.start / bucketCount) * 100}; --section-width: ${((section.end - section.start) / bucketCount) * 100}"
            >
              <span>${escapeHtml(section.label)}</span>
              <strong>${escapeHtml(counts[section.key])}</strong>
            </div>
          `).join("")}
        </div>
        ${distributionRows.map(row => {
          const height = Math.round((row.count / max) * 100);
          return `
            <div class="individual-histogram-column ${sectionForScore(row.value)}">
              <div class="individual-bar-slot" style="--height: ${height}">
                <div class="individual-frequency">${escapeHtml(row.count)}</div>
                <div class="score-histogram-bar${row.count ? "" : " is-empty"}" title="${escapeHtml(`Total ${row.value}: ${row.count}`)}"></div>
              </div>
              <div class="individual-score-label">${escapeHtml(row.value)}</div>
            </div>
          `;
        }).join("")}
        ${individualCutoffs.map(cutoff => `
          <div
            class="individual-cutoff-marker"
            style="--cutoff-left: ${(cutoff / bucketCount) * 100}"
            aria-hidden="true"
          >
            <span>${escapeHtml(cutoff)}+</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderProblemDistribution(problem, details) {
  const rows = details.distribution || [];
  const max = Math.max(1, ...rows.map(row => row.count));
  return `
    <article class="problem-panel">
      <div class="score-panel-header">
        <h3>P${escapeHtml(problem)}</h3>
        <span>Mean ${escapeHtml(formatNumber(details.stats?.mean))}</span>
      </div>
      <div class="problem-bars">
        ${rows.map(row => `
          <div class="problem-row">
            <span>${escapeHtml(row.value)}</span>
            <div class="problem-track" title="${escapeHtml(`${row.count} scores at ${row.value}`)}">
              <div class="problem-fill" style="--width: ${Math.round((row.count / max) * 100)}"></div>
            </div>
            <strong>${escapeHtml(row.count)}</strong>
          </div>
        `).join("")}
      </div>
      ${renderSummaryStats(details.stats)}
    </article>
  `;
}

function renderStats() {
  document.getElementById("snapshotMeta").textContent = formatSnapshotTime(data.generatedAt);
  if (!data.individualTotals) {
    document.getElementById("statsContent").innerHTML = `<div class="empty-state">No stats snapshot has been generated yet.</div>`;
    return;
  }

  document.getElementById("statsContent").innerHTML = `
    <section class="metric-grid">
      <div class="metric"><span>Students</span><strong>${escapeHtml(data.counts.students)}</strong></div>
      <div class="metric"><span>Teams</span><strong>${escapeHtml(data.counts.teams)}</strong></div>
    </section>

    <section class="score-section">
      <div class="score-section-header">
        <h2>Individual Total Distribution</h2>
        <p>Totals from 0 to 42, with announced award cutoffs fixed on the chart.</p>
      </div>
      <article class="score-panel individual-score-panel">
        ${renderSummaryStats(data.individualTotals.stats)}
        <div class="score-chart-pad">${renderIndividualHistogram(data.individualTotals.distribution)}</div>
      </article>
    </section>

    <section class="score-section">
      <div class="score-section-header">
        <h2>Problem Score Distributions</h2>
        <p>Score frequency for each problem, from 0 to 7.</p>
      </div>
      <div class="problem-grid">
        ${Object.entries(data.problemScores)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([problem, details]) => renderProblemDistribution(problem, details))
          .join("")}
      </div>
    </section>
  `;
}

renderStats();
