import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const dom = {
  configWarning: document.querySelector("#configWarning"),
  loadingView: document.querySelector("#loadingView"),
  statsView: document.querySelector("#statsView"),
  userMenu: document.querySelector("#userMenu"),
  avatarButton: document.querySelector("#avatarButton"),
  avatarMenu: document.querySelector("#avatarMenu"),
  signOutButton: document.querySelector("#signOutButton"),
  coordinatorLeaderboard: document.querySelector("#coordinatorLeaderboard"),
  countryLeaderboard: document.querySelector("#countryLeaderboard"),
  problemLeaderboard: document.querySelector("#problemLeaderboard")
};

const config = window.COORDINATION_SUPABASE_CONFIG;
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

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
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

async function loadStatsRows() {
  const [coordinators, countries, problems] = await Promise.all([
    supabase
      .from("coordination_stats_coordinators")
      .select("coordinator_id,name,avatar_seed,graded_count")
      .order("graded_count", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("coordination_stats_countries")
      .select("team_name,total_count,coordinated_count,ready_count"),
    supabase
      .from("coordination_stats_problems")
      .select("problem_id,total_count,coordinated_count,ready_count")
  ]);

  for (const result of [coordinators, countries, problems]) {
    if (result.error) throw result.error;
  }

  return {
    coordinators: coordinators.data || [],
    countries: sortProgressRows((countries.data || []).map(row => ({
      label: row.team_name,
      total: row.total_count,
      coordinated: row.coordinated_count,
      ready: row.ready_count
    }))),
    problems: sortProgressRows((problems.data || []).map(row => ({
      label: `P${row.problem_id}`,
      total: row.total_count,
      coordinated: row.coordinated_count,
      ready: row.ready_count
    })))
  };
}

function sortProgressRows(rows) {
  return rows.sort((a, b) => {
    const aProgress = (a.coordinated + a.ready) / a.total;
    const bProgress = (b.coordinated + b.ready) / b.total;
    return bProgress - aProgress
      || b.coordinated / b.total - a.coordinated / a.total
      || a.label.localeCompare(b.label, undefined, { numeric: true });
  });
}

function renderCoordinatorLeaderboard(rows) {
  if (!rows.length) return `<div class="empty-state">No PDF papers have been graded yet.</div>`;
  return rows.map((row, index) => `
    <article class="leaderboard-row">
      <span class="rank">${index + 1}</span>
      <img class="mini-avatar" src="${avatarUrl(avatarSeedForPerson(row))}" alt="">
      <span class="leaderboard-name">${escapeHtml(row.name)}</span>
      <span class="leaderboard-count">${row.graded_count}</span>
    </article>
  `).join("");
}

function renderProgressLeaderboard(rows) {
  if (!rows.length) return `<div class="empty-state">No PDF papers are available yet.</div>`;
  return rows.map((row, index) => {
    const coordinatedPercent = percent(row.coordinated, row.total);
    const readyPercent = percent(row.ready, row.total);
    const progressPercent = percent(row.coordinated + row.ready, row.total);
    return `
      <article class="progress-row">
        <div class="progress-row-header">
          <span><span class="rank">${index + 1}</span>${escapeHtml(row.label)}</span>
          <span>${progressPercent}%</span>
        </div>
        <div
          class="stacked-progress"
          aria-label="${escapeHtml(row.label)}: ${row.coordinated} coordinated, ${row.ready} ready, ${row.total} total"
        >
          <span class="progress-segment coordinated" style="width: ${coordinatedPercent}%"></span>
          <span class="progress-segment ready" style="width: ${readyPercent}%"></span>
        </div>
        <div class="progress-meta">
          <span>${row.coordinated}/${row.total} coordinated</span>
          <span>${row.ready}/${row.total} ready</span>
        </div>
      </article>
    `;
  }).join("");
}

function renderStats(stats) {
  dom.coordinatorLeaderboard.innerHTML = renderCoordinatorLeaderboard(stats.coordinators);
  dom.countryLeaderboard.innerHTML = renderProgressLeaderboard(stats.countries);
  dom.problemLeaderboard.innerHTML = renderProgressLeaderboard(stats.problems);
}

function bindEvents() {
  dom.avatarButton.addEventListener("click", () => {
    const nextHidden = !dom.avatarMenu.hidden;
    dom.avatarMenu.hidden = nextHidden;
    dom.avatarButton.setAttribute("aria-expanded", String(!nextHidden));
  });

  dom.signOutButton.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.replace("../");
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
      window.location.replace("../");
      return;
    }

    await loadCoordinator();
    const stats = await loadStatsRows();
    renderAvatarButton();
    renderStats(stats);
    dom.userMenu.hidden = false;
    dom.loadingView.hidden = true;
    dom.statsView.hidden = false;
  } catch (error) {
    dom.loadingView.classList.add("danger");
    dom.loadingView.textContent = error.message;
  }
}

void init();
