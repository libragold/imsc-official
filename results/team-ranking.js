(() => {
  const FALLBACK_PROBLEMS = [1, 2, 3, 4, 5, 6];
  const data = window.IMSC_RESULTS_DATA || {};
  const problems = Array.isArray(data.problems) && data.problems.length ? data.problems : FALLBACK_PROBLEMS;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function scoreClass(score) {
    return score?.value == null ? " is-pending" : "";
  }

  function scoreLabel(score) {
    return score?.value == null ? "-" : score.value;
  }

  function scoreTitle(student, problem, score) {
    if (score?.value == null) return `${student.label} P${problem} is pending`;
    return `${student.label} P${problem}: ${score.value}`;
  }

  function normalizedStudentScores(student) {
    const scoreMap = student.scores || {};
    return problems.map(problem => {
      const key = String(problem);
      const rawScore = scoreMap[key] ?? scoreMap[problem] ?? null;
      const rawValue = rawScore && typeof rawScore === "object" && "value" in rawScore ? rawScore.value : rawScore;
      return { problem, value: rawValue };
    });
  }

  function renderStudentRow(student) {
    const scores = normalizedStudentScores(student);
    const total = student.revealedTotal ?? scores.reduce((sum, score) => sum + (score.value == null ? 0 : Number(score.value)), 0);
    return `
      <div class="team-ranking-student-row">
        <span class="team-ranking-student-label" title="${escapeHtml(student.label)}">${escapeHtml(student.label)}</span>
        ${scores.map(score => `
          <span
            class="team-ranking-score-pill${scoreClass(score)}"
            title="${escapeHtml(scoreTitle(student, score.problem, score))}"
            aria-label="${escapeHtml(scoreTitle(student, score.problem, score))}"
          >${escapeHtml(scoreLabel(score))}</span>
        `).join("")}
        <span class="team-ranking-student-total" title="${escapeHtml(`${student.label} total`)}">${escapeHtml(total)}</span>
      </div>
    `;
  }

  function renderTeamRow(team, index) {
    const rank = team.rank ?? index + 1;
    const students = Array.isArray(team.students) ? team.students : [];
    return `
      <tr>
        <th scope="row" class="team-ranking-rank-cell">${escapeHtml(rank)}</th>
        <td class="team-ranking-team-cell">
          <div class="team-ranking-team-line">
            <span class="team-ranking-flag" aria-hidden="true">${escapeHtml(team.flag || "")}</span>
            <span>${escapeHtml(team.teamName || team.name || team.teamCode || "Team")}</span>
          </div>
        </td>
        <td class="team-ranking-students-cell">
          <div class="team-ranking-score-board">
            <div class="team-ranking-score-header" aria-hidden="true">
              <span>Student</span>
              ${problems.map(problem => `<span>P${escapeHtml(problem)}</span>`).join("")}
              <span>Total</span>
            </div>
            ${students.map(renderStudentRow).join("")}
          </div>
        </td>
        <td class="team-ranking-total-cell">
          <div class="team-ranking-total">${escapeHtml(team.revealedTotal ?? 0)}</div>
        </td>
      </tr>
    `;
  }

  function renderTeamRanking() {
    const content = document.getElementById("teamRankingContent");
    if (!content) return;

    const teams = Array.isArray(data.teams) ? [...data.teams] : [];
    if (!teams.length) {
      content.innerHTML = `<div class="team-ranking-empty">No team ranking snapshot has been generated yet.</div>`;
      return;
    }

    teams.sort((a, b) =>
      Number(b.revealedTotal || 0) - Number(a.revealedTotal || 0) ||
      String(a.teamName || a.teamCode || "").localeCompare(String(b.teamName || b.teamCode || ""))
    );

    content.innerHTML = `
      <section class="team-ranking-board" aria-label="IMSC 2026 team ranking">
        <div class="team-ranking-scroll">
          <table class="team-ranking-table">
            <colgroup>
              <col class="team-ranking-rank-col">
              <col class="team-ranking-team-col">
              <col class="team-ranking-students-col">
              <col class="team-ranking-total-col">
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Team</th>
                <th scope="col">Student Scores</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              ${teams.map(renderTeamRow).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  renderTeamRanking();
})();
