import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FALLBACK_COORDINATORS = [
  "Anca Sfia",
  "Andrei Bud",
  "Andrei Jorza",
  "Bojan Basic",
  "Cezar Lupu",
  "Cipriana Anghel-Stan",
  "Dinu Serbanescu",
  "Dorian Croitoru",
  "Dusan Djukic",
  "Iulia Cristian",
  "Ivan Chan Kai Chin",
  "Nikola Petrovic",
  "Qiang Shen",
  "Stijn Cambie",
  "Tudor Paisanu",
  "Vlad Matei",
  "Wei Luo",
  "Zilin Jiang"
];

const dom = {
  shell: document.querySelector("#shell"),
  configWarning: document.querySelector("#configWarning"),
  loginView: document.querySelector("#loginView"),
  appView: document.querySelector("#appView"),
  loginForm: document.querySelector("#loginForm"),
  coordinatorSelect: document.querySelector("#coordinatorSelect"),
  passwordInput: document.querySelector("#passwordInput"),
  userMenu: document.querySelector("#userMenu"),
  avatarButton: document.querySelector("#avatarButton"),
  avatarMenu: document.querySelector("#avatarMenu"),
  changeAvatarButton: document.querySelector("#changeAvatarButton"),
  signOutButton: document.querySelector("#signOutButton"),
  claimedCount: document.querySelector("#claimedCount"),
  gradedCount: document.querySelector("#gradedCount"),
  coordinatedCount: document.querySelector("#coordinatedCount"),
  claimedTeamFilter: document.querySelector("#claimedTeamFilter"),
  claimedProblemFilter: document.querySelector("#claimedProblemFilter"),
  gradedTeamFilter: document.querySelector("#gradedTeamFilter"),
  gradedProblemFilter: document.querySelector("#gradedProblemFilter"),
  coordinatedTeamFilter: document.querySelector("#coordinatedTeamFilter"),
  coordinatedProblemFilter: document.querySelector("#coordinatedProblemFilter"),
  claimedList: document.querySelector("#claimedList"),
  gradedList: document.querySelector("#gradedList"),
  coordinatedList: document.querySelector("#coordinatedList"),
  openClaimDialogButton: document.querySelector("#openClaimDialogButton"),
  claimDialog: document.querySelector("#claimDialog"),
  claimTeamFilter: document.querySelector("#claimTeamFilter"),
  claimProblemFilter: document.querySelector("#claimProblemFilter"),
  claimHelpFilter: document.querySelector("#claimHelpFilter"),
  claimPaperList: document.querySelector("#claimPaperList"),
  initialScoreDialog: document.querySelector("#initialScoreDialog"),
  initialScoreForm: document.querySelector("#initialScoreForm"),
  initialScorePaper: document.querySelector("#initialScorePaper"),
  initialScoreMessage: document.querySelector("#initialScoreMessage"),
  agreedScoreDialog: document.querySelector("#agreedScoreDialog"),
  agreedScoreForm: document.querySelector("#agreedScoreForm"),
  agreedScorePaper: document.querySelector("#agreedScorePaper"),
  agreedScoreMessage: document.querySelector("#agreedScoreMessage"),
  avatarDialog: document.querySelector("#avatarDialog"),
  avatarForm: document.querySelector("#avatarForm"),
  avatarPreview: document.querySelector("#avatarPreview"),
  avatarSeedInput: document.querySelector("#avatarSeedInput"),
  avatarMessage: document.querySelector("#avatarMessage"),
  randomAvatarSeedButton: document.querySelector("#randomAvatarSeedButton"),
  releaseConfirmDialog: document.querySelector("#releaseConfirmDialog"),
  releaseConfirmForm: document.querySelector("#releaseConfirmForm"),
  releaseConfirmTitle: document.querySelector("#releaseConfirmTitle"),
  releaseConfirmPaper: document.querySelector("#releaseConfirmPaper"),
  releaseConfirmMessage: document.querySelector("#releaseConfirmMessage"),
  releaseConfirmSubmit: document.querySelector("#releaseConfirmSubmit")
};

const config = window.COORDINATION_SUPABASE_CONFIG;
const FILTER_STORAGE_KEY = "imsc2026.coordination.filters.v1";
const CLAIM_PAGE_SIZE = 15;
let supabase = null;
let currentUser = null;
let currentCoordinator = null;
let papers = [];
let teams = [];
let coordinators = [];
let problemIds = [1, 2, 3, 4, 5, 6];
let activePaperId = null;
let pendingConfirmAction = null;
let filterState = loadFilterState();
let tooltipElement = null;
let tooltipTarget = null;
let claimDialogPage = 1;
let claimDialogPapers = [];
let claimDialogTotal = 0;
let myPapersChannel = null;
let myPapersRefreshTimer = null;
let isRefreshingMyPapers = false;

function loadFilterState() {
  try {
    return JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveFilterState() {
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filterState));
}

function setFilterState(key, value) {
  filterState[key] = value;
  saveFilterState();
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

function coordinatorEmail(name) {
  return `${slugName(name)}@${config.emailDomain || "imsc-coordination.local"}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function avatarSeed() {
  return currentCoordinator?.avatar_seed || firstNameSeed(currentCoordinator?.name || "coordinator");
}

function avatarUrl(seed) {
  return `https://api.dicebear.com/9.x/micah/svg?seed=${encodeURIComponent(seed)}`;
}

function avatarSeedForPerson(person) {
  return person?.avatar_seed || firstNameSeed(person?.name || "coordinator");
}

function randomSeed() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

function formatPaper(paper) {
  return `${paper.team_name} · ${paper.student_name} · P${paper.problem_id}`;
}

function formatCompactPaper(paper) {
  return `${paper.team_code || paper.team_name}-${paper.team_index} · P${paper.problem_id}`;
}

function formatPaperTitle(paper) {
  return formatCompactPaper(paper);
}

function scoreLabel(value) {
  return value === null || value === undefined ? "none" : String(value);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "object") return Object.values(value);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function currentInitialScores(paper) {
  const scores = asArray(paper.current_initial_scores);
  if (scores.length) return scores;
  if (paper.my_initial_score != null && currentCoordinator) {
    return [{
      coordinator_id: currentCoordinator.id,
      name: currentCoordinator.name,
      avatar_seed: currentCoordinator.avatar_seed,
      score: paper.my_initial_score
    }];
  }
  if (paper.initial_score != null && paper.initial_score_coordinator_name) {
    return [{
      coordinator_id: paper.initial_score_coordinator_id,
      name: paper.initial_score_coordinator_name,
      avatar_seed: null,
      score: paper.initial_score
    }];
  }
  return [];
}

function hasInitialScoreConflict(paper) {
  const scores = new Set(currentInitialScores(paper).map(entry => Number(entry.score)));
  return scores.size > 1;
}

function unanimousInitialScore(paper) {
  const scores = currentInitialScores(paper).map(entry => Number(entry.score));
  if (scores.length < 2) return null;
  return new Set(scores).size === 1 ? scores[0] : null;
}

function canCoordinatePaper(paper) {
  return currentInitialScores(paper).length >= 2;
}

function hasOtherInitialScore(paper) {
  return currentInitialScores(paper).some(entry => entry.coordinator_id !== currentCoordinator.id);
}

function setBusy(button, busy) {
  if (button) button.disabled = busy;
}

function setMessage(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function claimState(paper) {
  const claims = activeClaims(paper);
  if (claims.some(claim => claim.coordinator_id === currentCoordinator.id)) return "mine";
  if (claims.length) return "other";
  return "unclaimed";
}

function myActiveClaim(paper) {
  return activeClaims(paper).find(claim => claim.coordinator_id === currentCoordinator.id) || null;
}

function paperById(paperId) {
  return papers.find(paper => paper.paper_id === paperId)
    || claimDialogPapers.find(paper => paper.paper_id === paperId)
    || null;
}

function isIntegerScore(value) {
  return value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 7;
}

function initLoginOptions() {
  const names = coordinators.length ? coordinators.map(coordinator => coordinator.name) : FALLBACK_COORDINATORS;
  const coordinatorOptions = names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
  dom.coordinatorSelect.innerHTML = [
    `<option value="" selected disabled></option>`,
    ...coordinatorOptions
  ].join("");
}

function configureSupabase() {
  const hasPlaceholder =
    /your-project-ref|YOUR_|sb_publishable_or_anon_key/i.test(config?.url || "") ||
    /your-project-ref|YOUR_|sb_publishable_or_anon_key/i.test(config?.publishableKey || "");

  if (!config?.url || !config?.publishableKey || hasPlaceholder) {
    dom.configWarning.hidden = false;
    dom.loginView.hidden = true;
    dom.appView.hidden = true;
    return false;
  }

  supabase = createClient(config.url, config.publishableKey);
  return true;
}

async function refreshSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  currentUser = data.session?.user || null;

  if (!currentUser) {
    unsubscribeMyPapersRealtime();
    currentCoordinator = null;
    teams = [];
    coordinators = [];
    initLoginOptions();
    renderLogin();
    return;
  }

  await loadMetadata();
  initLoginOptions();
  await loadCoordinator();
  await loadMyPapers();
  renderApp();
  subscribeMyPapersRealtime();
}

async function loadCoordinator() {
  const { data, error } = await supabase
    .from("coordinators")
    .select("id,name,active,auth_user_id,avatar_seed")
    .eq("auth_user_id", currentUser.id)
    .single();

  if (error) throw error;
  currentCoordinator = data;
}

async function loadMetadata() {
  await Promise.all([
    loadTeams(),
    loadCoordinators()
  ]);
}

async function loadTeams() {
  const { data, error } = await supabase
    .from("teams")
    .select("id,name,code")
    .order("name", { ascending: true });

  if (error) throw error;
  teams = data || [];
}

async function loadCoordinators() {
  const { data, error } = await supabase
    .from("coordinators")
    .select("id,name,avatar_seed,active")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) throw error;
  coordinators = data || [];
}

async function loadMyPapers() {
  const { data, error } = await supabase
    .from("paper_status")
    .select("*")
    .not("active_claim_id", "is", null)
    .order("team_name", { ascending: true })
    .order("team_index", { ascending: true })
    .order("problem_id", { ascending: true });

  if (error) throw error;
  papers = data || [];
}

function subscribeMyPapersRealtime() {
  unsubscribeMyPapersRealtime();
  myPapersChannel = supabase.channel("coordination-my-papers");
  ["paper_claims", "initial_score_history", "agreed_score_history", "papers"].forEach(table => {
    myPapersChannel.on("postgres_changes", {
      event: "*",
      schema: "public",
      table
    }, scheduleMyPapersRefresh);
  });
  myPapersChannel.subscribe();
}

function unsubscribeMyPapersRealtime() {
  if (myPapersRefreshTimer) {
    clearTimeout(myPapersRefreshTimer);
    myPapersRefreshTimer = null;
  }
  if (myPapersChannel) {
    supabase.removeChannel(myPapersChannel);
    myPapersChannel = null;
  }
}

function scheduleMyPapersRefresh() {
  if (!currentUser) return;
  if (myPapersRefreshTimer) clearTimeout(myPapersRefreshTimer);
  myPapersRefreshTimer = setTimeout(refreshMyPapersFromRealtime, 350);
}

async function refreshMyPapersFromRealtime() {
  myPapersRefreshTimer = null;
  if (!currentUser || isRefreshingMyPapers) return;
  isRefreshingMyPapers = true;
  try {
    await loadMyPapers();
    renderBoard();
  } catch (error) {
    console.error("Failed to refresh coordination board", error);
  } finally {
    isRefreshingMyPapers = false;
  }
}

function renderLogin() {
  dom.shell.classList.add("auth-shell");
  dom.userMenu.hidden = true;
  dom.avatarMenu.hidden = true;
  dom.loginView.hidden = false;
  dom.appView.hidden = true;
}

function renderApp() {
  dom.shell.classList.remove("auth-shell");
  dom.userMenu.hidden = false;
  dom.loginView.hidden = true;
  dom.appView.hidden = false;
  renderAvatarButton();
  renderPileFilters();
  renderBoard();
  renderClaimFilters();
}

function renderAvatarButton() {
  dom.avatarButton.innerHTML = `
    <img src="${avatarUrl(avatarSeed())}" alt="">
    <span>${escapeHtml(currentCoordinator.name)}</span>
  `;
  dom.avatarButton.setAttribute("aria-label", `Menu for ${currentCoordinator.name}`);
}

function boardPiles() {
  const mine = papers.filter(paper => claimState(paper) === "mine");
  const coordinated = mine.filter(paper => paper.agreed_score !== null);
  const claimed = mine.filter(paper => paper.agreed_score === null && paper.my_initial_score == null);
  const graded = mine.filter(paper => paper.my_initial_score != null && paper.agreed_score == null);
  return { claimed, graded, coordinated };
}

function renderBoard() {
  hideBoundaryTooltip();
  const { claimed, graded, coordinated } = boardPiles();
  const filteredClaimed = applyPileFilters(claimed, "claimed");
  const filteredGraded = applyPileFilters(graded, "graded");
  const filteredCoordinated = applyPileFilters(coordinated, "coordinated");
  dom.claimedCount.textContent = `${filteredClaimed.length}/${claimed.length}`;
  dom.gradedCount.textContent = `${filteredGraded.length}/${graded.length}`;
  dom.coordinatedCount.textContent = `${filteredCoordinated.length}/${coordinated.length}`;
  dom.claimedList.innerHTML = renderCards(filteredClaimed, "claimed");
  dom.gradedList.innerHTML = renderCards(filteredGraded, "graded");
  dom.coordinatedList.innerHTML = renderCards(filteredCoordinated, "coordinated");
}

function renderCards(items, pile) {
  if (!items.length) return `<div class="empty-state">No papers here.</div>`;
  return items.map(paper => renderCard(paper, pile)).join("");
}

function renderCard(paper, pile) {
  const claim = claimState(paper);
  const sideAction = renderCardSideAction(paper, pile, claim);
  const avatars = renderCardAvatars(paper);
  const conflictClass = pile === "graded" && hasInitialScoreConflict(paper) ? " score-conflict" : "";
  const helpReadyClass = pile === "claimed" && paper.my_initial_score == null && hasOtherInitialScore(paper)
    ? " score-waiting"
    : "";

  return `
    <article class="paper-card compact-card${conflictClass}${helpReadyClass}">
      <div class="paper-card-main">
        <span>${escapeHtml(formatCompactPaper(paper))}</span>
      </div>
      ${avatars}
      ${sideAction}
    </article>
  `;
}

function compactPointLabel(score) {
  return Number(score) === 1 ? "pt" : "pts";
}

function renderAvatar(person, tooltip, className = "") {
  const label = tooltip || person.name || "";
  return `
    <span class="avatar-tooltip has-tooltip ${className}" data-tooltip="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" tabindex="0">
      <img
        class="mini-avatar"
        src="${avatarUrl(avatarSeedForPerson(person))}"
        alt="${escapeHtml(person.name || "")}"
      >
    </span>
  `;
}

function activeClaims(paper) {
  let claims = asArray(paper.active_claims);
  if (!claims.length && paper.active_claim_id && currentCoordinator) {
    claims = [{
      claim_id: paper.active_claim_id,
      coordinator_id: currentCoordinator.id,
      name: currentCoordinator.name,
      avatar_seed: currentCoordinator.avatar_seed
    }];
  }
  return claims;
}

function claimAvatarTooltip(claim, paper) {
  const lines = [claim.name];
  const initialScore = currentInitialScores(paper).find(entry => entry.coordinator_id === claim.coordinator_id);
  if (initialScore) lines.push(`Awarded ${initialScore.score} ${compactPointLabel(initialScore.score)}`);
  if (paper.agreed_score_coordinator_id === claim.coordinator_id) {
    lines.push(`Finalized at ${paper.agreed_score} ${compactPointLabel(paper.agreed_score)}`);
  }
  return lines.join("\n");
}

function renderCardAvatars(paper) {
  const claims = activeClaims(paper);
  const avatars = claims.map(claim => {
    const className = paper.agreed_score_coordinator_id === claim.coordinator_id ? "finalized-avatar" : "";
    return renderAvatar(claim, claimAvatarTooltip(claim, paper), className);
  });
  if (!avatars.length) return `<div class="avatar-stack"></div>`;
  return `<div class="avatar-stack">${avatars.join("")}</div>`;
}

function renderClaimDialogAvatars(paper) {
  const people = new Map();
  activeClaims(paper).forEach(claim => people.set(claim.coordinator_id, claim));
  currentInitialScores(paper).forEach(score => people.set(score.coordinator_id, score));
  const avatars = [...people.values()].map(person => renderAvatar(person, person.name || ""));
  if (!avatars.length) return `<div class="avatar-stack"></div>`;
  return `<div class="avatar-stack">${avatars.join("")}</div>`;
}

function hasPdf(paper) {
  return Boolean(paper?.pdf_path);
}

function renderPdfButton(paper) {
  if (!hasPdf(paper)) return "";
  return `
    <button class="secondary-action pdf-action open-paper-pdf" type="button" data-paper-id="${paper.paper_id}" aria-label="Open PDF for ${escapeHtml(formatPaper(paper))}">PDF</button>
  `;
}

function ensureTooltipElement(parent = document.body) {
  if (tooltipElement) return tooltipElement;
  tooltipElement = document.createElement("div");
  tooltipElement.className = "viewport-tooltip";
  tooltipElement.hidden = true;
  parent.append(tooltipElement);
  return tooltipElement;
}

function showBoundaryTooltip(target) {
  const text = target.dataset.tooltip?.trim();
  if (!text) return;
  tooltipTarget = target;
  const tooltipParent = target.closest("dialog[open]") || document.body;
  const tooltip = ensureTooltipElement(tooltipParent);
  if (tooltip.parentElement !== tooltipParent) tooltipParent.append(tooltip);
  tooltip.textContent = text;
  tooltip.hidden = false;
  positionBoundaryTooltip();
}

function hideBoundaryTooltip(target = null) {
  if (target && target !== tooltipTarget) return;
  if (tooltipElement) tooltipElement.hidden = true;
  tooltipTarget = null;
}

function positionBoundaryTooltip() {
  if (!tooltipElement || tooltipElement.hidden || !tooltipTarget) return;
  if (!document.documentElement.contains(tooltipTarget)) {
    hideBoundaryTooltip();
    return;
  }

  const margin = 8;
  const gap = 8;
  const targetRect = tooltipTarget.getBoundingClientRect();
  const tooltipRect = tooltipElement.getBoundingClientRect();
  const targetCenter = targetRect.left + targetRect.width / 2;
  let left = targetCenter - tooltipRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));

  let placement = "top";
  let top = targetRect.top - tooltipRect.height - gap;
  if (top < margin) {
    placement = "bottom";
    top = targetRect.bottom + gap;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

  tooltipElement.dataset.placement = placement;
  tooltipElement.style.left = `${left}px`;
  tooltipElement.style.top = `${top}px`;
  const arrowLeft = Math.max(10, Math.min(targetCenter - left, tooltipRect.width - 10));
  tooltipElement.style.setProperty("--tooltip-arrow-left", `${arrowLeft}px`);
}

function renderCardSideAction(paper, pile, claim) {
  if (claim !== "mine") return "";
  const pdfButton = renderPdfButton(paper);
  if (pile === "claimed") {
    const myClaim = myActiveClaim(paper);
    return `
      <div class="card-actions-inline">
        ${pdfButton}
        <button class="primary-action open-initial-score" type="button" data-paper-id="${paper.paper_id}" aria-label="Grade ${escapeHtml(formatPaper(paper))}">Grade</button>
        <button class="secondary-action release-claim" type="button" data-paper-id="${paper.paper_id}" data-claim-id="${myClaim?.claim_id || paper.active_claim_id || ""}" aria-label="Remove ${escapeHtml(formatPaper(paper))}">Remove</button>
      </div>
    `;
  }
  if (pile === "graded") {
    return `
      <div class="card-actions-inline">
        ${pdfButton}
        <button class="secondary-action open-initial-score" type="button" data-paper-id="${paper.paper_id}" aria-label="Edit initial score for ${escapeHtml(formatPaper(paper))}">Edit</button>
        ${canCoordinatePaper(paper) ? `<button class="primary-action open-agreed-score" type="button" data-paper-id="${paper.paper_id}" aria-label="Coordinate ${escapeHtml(formatPaper(paper))}">Coordinate</button>` : ""}
      </div>
    `;
  }
  if (pile === "coordinated") {
    return `
      <div class="card-actions-inline">
        ${pdfButton}
        <button class="secondary-action open-agreed-score" type="button" data-paper-id="${paper.paper_id}" aria-label="Edit agreed score for ${escapeHtml(formatPaper(paper))}">Edit</button>
      </div>
    `;
  }
  return "";
}

function renderPileFilters() {
  const teamOptions = teams.map(team => team.name);
  [
    ["claimed", dom.claimedTeamFilter, dom.claimedProblemFilter],
    ["graded", dom.gradedTeamFilter, dom.gradedProblemFilter],
    ["coordinated", dom.coordinatedTeamFilter, dom.coordinatedProblemFilter]
  ].forEach(([key, teamFilter, problemFilter]) => {
    const currentTeam = filterState[`${key}Team`] ?? teamFilter.value;
    const currentProblem = filterState[`${key}Problem`] ?? problemFilter.value;
    teamFilter.innerHTML = [
      `<option value="">All</option>`,
      ...teamOptions.map(team => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`)
    ].join("");
    problemFilter.innerHTML = [
      `<option value="">All</option>`,
      ...problemIds.map(id => `<option value="${id}">P${id}</option>`)
    ].join("");
    teamFilter.value = teamOptions.includes(currentTeam) ? currentTeam : "";
    problemFilter.value = problemIds.map(String).includes(currentProblem) ? currentProblem : "";
    filterState[`${key}Team`] = teamFilter.value;
    filterState[`${key}Problem`] = problemFilter.value;
  });
  saveFilterState();
}

function applyPileFilters(items, pile) {
  const map = {
    claimed: [dom.claimedTeamFilter, dom.claimedProblemFilter],
    graded: [dom.gradedTeamFilter, dom.gradedProblemFilter],
    coordinated: [dom.coordinatedTeamFilter, dom.coordinatedProblemFilter]
  };
  const [teamFilter, problemFilter] = map[pile];
  return items.filter(paper => {
    if (teamFilter.value && paper.team_name !== teamFilter.value) return false;
    if (problemFilter.value && String(paper.problem_id) !== problemFilter.value) return false;
    return true;
  });
}

function renderClaimFilters() {
  const teamOptions = teams.map(team => team.name);
  const current = filterState.claimDialogTeam ?? dom.claimTeamFilter.value;
  const helpers = claimHelpOptions();
  const currentHelper = filterState.claimDialogHelp ?? dom.claimHelpFilter.value;
  dom.claimTeamFilter.innerHTML = [
    `<option value="">All</option>`,
    ...teamOptions.map(team => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`)
  ].join("");
  dom.claimProblemFilter.innerHTML = problemIds
    .map(id => `<option value="${id}">P${id}</option>`)
    .join("");
  dom.claimHelpFilter.innerHTML = [
    `<option value="">All</option>`,
    ...helpers.map(helper => `<option value="${escapeHtml(helper.id)}">${escapeHtml(helper.name)}</option>`)
  ].join("");
  dom.claimTeamFilter.value = teamOptions.includes(current) ? current : "";
  dom.claimProblemFilter.value = problemIds.map(String).includes(filterState.claimDialogProblem)
    ? filterState.claimDialogProblem
    : String(problemIds[0] || 1);
  dom.claimHelpFilter.value = helpers.some(helper => helper.id === currentHelper) ? currentHelper : "";
  filterState.claimDialogTeam = dom.claimTeamFilter.value;
  filterState.claimDialogProblem = dom.claimProblemFilter.value;
  filterState.claimDialogHelp = dom.claimHelpFilter.value;
  saveFilterState();
}

function claimHelpOptions() {
  return coordinators
    .filter(coordinator => coordinator.id !== currentCoordinator.id)
    .map(coordinator => ({ id: coordinator.id, name: coordinator.name }));
}

async function loadClaimDialogPapers() {
  const team = dom.claimTeamFilter.value;
  const problem = dom.claimProblemFilter.value;
  const helperId = dom.claimHelpFilter.value;
  const from = (claimDialogPage - 1) * CLAIM_PAGE_SIZE;
  const to = from + CLAIM_PAGE_SIZE - 1;

  let query = supabase
    .from("paper_status")
    .select("*", { count: "exact" })
    .is("agreed_score", null)
    .is("active_claim_id", null)
    .lte("current_initial_score_count", 1)
    .order("team_name", { ascending: true })
    .order("team_index", { ascending: true })
    .order("problem_id", { ascending: true })
    .range(from, to);

  if (team) query = query.eq("team_name", team);
  if (problem) query = query.eq("problem_id", Number(problem));
  if (helperId) query = query.filter("active_claims", "cs", JSON.stringify([{ coordinator_id: helperId }]));

  const { data, error, count } = await query;
  if (error) throw error;
  claimDialogPapers = data || [];
  claimDialogTotal = count || 0;
}

async function renderClaimDialog() {
  dom.claimPaperList.innerHTML = `<div class="empty-state">Loading papers...</div>`;
  try {
    await loadClaimDialogPapers();
  } catch (error) {
    dom.claimPaperList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    return;
  }

  let pageCount = Math.max(1, Math.ceil(claimDialogTotal / CLAIM_PAGE_SIZE));
  if (!claimDialogPapers.length && claimDialogTotal > 0 && claimDialogPage > pageCount) {
    claimDialogPage = pageCount;
    await loadClaimDialogPapers();
    pageCount = Math.max(1, Math.ceil(claimDialogTotal / CLAIM_PAGE_SIZE));
  }

  if (!claimDialogPapers.length) {
    dom.claimPaperList.innerHTML = `<div class="empty-state">No papers match these filters.</div>`;
    return;
  }

  claimDialogPage = Math.max(1, Math.min(claimDialogPage, pageCount));
  const rows = claimDialogPapers.map(paper => {
    const claim = claimState(paper);
    const disabled = claim === "mine";
    const label = claim === "mine" ? "Claimed" : "Claim";
    return `
      <article class="picker-row">
        <div>
          <strong>${escapeHtml(formatCompactPaper(paper))}</strong>
        </div>
        ${renderClaimDialogAvatars(paper)}
        <div class="card-actions-inline">
          ${renderPdfButton(paper)}
          <button class="claim-paper" type="button" data-paper-id="${paper.paper_id}" ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>
        </div>
      </article>
    `;
  }).join("");

  dom.claimPaperList.innerHTML = `
    <div class="paper-picker-grid">${rows}</div>
    <div class="claim-pagination">
      <button class="ghost claim-page" type="button" data-page-delta="-1" ${claimDialogPage === 1 ? "disabled" : ""}>Previous</button>
      <span>Page ${claimDialogPage} of ${pageCount} · ${claimDialogTotal} papers</span>
      <button class="ghost claim-page" type="button" data-page-delta="1" ${claimDialogPage === pageCount ? "disabled" : ""}>Next</button>
    </div>
  `;
}

function openClaimDialog() {
  claimDialogPage = 1;
  void renderClaimDialog();
  dom.claimDialog.showModal();
}

function openInitialScoreDialog(paperId) {
  const paper = paperById(paperId);
  if (!paper) return;
  activePaperId = paperId;
  dom.initialScorePaper.textContent = formatPaperTitle(paper);
  dom.initialScoreForm.reset();
  dom.initialScoreForm.elements.score.value = paper.my_initial_score ?? "";
  setMessage(dom.initialScoreMessage, "");
  dom.initialScoreDialog.showModal();
  dom.initialScoreForm.elements.score.focus();
}

function openAgreedScoreDialog(paperId) {
  const paper = paperById(paperId);
  if (!paper) return;
  activePaperId = paperId;
  dom.agreedScorePaper.textContent = formatCompactPaper(paper);
  dom.agreedScoreForm.reset();
  dom.agreedScoreForm.elements.score.value = paper.agreed_score ?? unanimousInitialScore(paper) ?? "";
  setMessage(dom.agreedScoreMessage, "");
  dom.agreedScoreDialog.showModal();
  dom.agreedScoreForm.elements.score.focus();
}

function openAvatarDialog() {
  const seed = avatarSeed();
  dom.avatarSeedInput.value = seed;
  dom.avatarPreview.src = avatarUrl(seed);
  setMessage(dom.avatarMessage, "");
  dom.avatarDialog.showModal();
}

async function refreshAll() {
  await loadCoordinator();
  await loadMyPapers();
  renderApp();
  if (dom.claimDialog.open) await renderClaimDialog();
}

async function claimPaper(paperId, button) {
  setBusy(button, true);
  try {
    const { error } = await supabase.rpc("claim_paper", { p_paper_id: paperId });
    if (error) throw error;
    await refreshAll();
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(button, false);
  }
}

async function releaseClaim(claimId, button) {
  setBusy(button, true);
  try {
    const { error } = await supabase.rpc("release_claim", { p_claim_id: claimId });
    if (error) throw error;
    await refreshAll();
    return true;
  } catch (error) {
    alert(error.message);
    return false;
  } finally {
    setBusy(button, false);
  }
}

async function openPaperPdf(paperId, button) {
  const paper = paperById(paperId);
  if (!hasPdf(paper)) return;

  setBusy(button, true);
  try {
    const { data, error } = await supabase.storage
      .from(paper.pdf_bucket || "paper-pdfs")
      .createSignedUrl(paper.pdf_path, 60 * 60);
    if (error) throw error;

    const opened = window.open(data.signedUrl, "_blank");
    if (opened) {
      opened.opener = null;
    } else {
      window.location.href = data.signedUrl;
    }
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(button, false);
  }
}

async function clearInitialScore(paperId, button) {
  setBusy(button, true);
  try {
    const { error } = await supabase.rpc("clear_initial_score", { p_paper_id: paperId });
    if (error) throw error;
    await refreshAll();
    return true;
  } catch (error) {
    alert(error.message);
    return false;
  } finally {
    setBusy(button, false);
  }
}

function openConfirmAction(action) {
  pendingConfirmAction = action;
  dom.releaseConfirmTitle.textContent = action.title;
  dom.releaseConfirmPaper.textContent = action.paperLabel;
  dom.releaseConfirmMessage.textContent = action.message;
  dom.releaseConfirmSubmit.textContent = action.submitLabel;
  dom.releaseConfirmDialog.showModal();
}

async function submitInitialScore(form) {
  const scoreValue = form.elements.score.value;
  const button = form.querySelector("button[type='submit']");
  const paper = paperById(activePaperId);
  if (scoreValue === "" && paper?.my_initial_score != null) {
    const ok = await clearInitialScore(activePaperId, button);
    if (ok) dom.initialScoreDialog.close();
    return;
  }
  if (!isIntegerScore(scoreValue)) {
    setMessage(dom.initialScoreMessage, "Enter an integer score from 0 to 7.", true);
    return;
  }

  setBusy(button, true);
  try {
    const { error } = await supabase.rpc("submit_initial_score", {
      p_paper_id: activePaperId,
      p_score: Number(scoreValue)
    });
    if (error) throw error;
    dom.initialScoreDialog.close();
    await refreshAll();
  } catch (error) {
    setMessage(dom.initialScoreMessage, error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function submitAgreedScore(form) {
  const scoreValue = form.elements.score.value;
  const button = form.querySelector("button[type='submit']");
  if (!isIntegerScore(scoreValue)) {
    setMessage(dom.agreedScoreMessage, "Enter an integer score from 0 to 7.", true);
    return;
  }

  setBusy(button, true);
  try {
    const { error } = await supabase.rpc("submit_agreed_score", {
      p_paper_id: activePaperId,
      p_score: Number(scoreValue),
      p_team_leader_signature: ""
    });
    if (error) throw error;
    dom.agreedScoreDialog.close();
    await refreshAll();
  } catch (error) {
    setMessage(dom.agreedScoreMessage, error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function saveAvatarSeed(form) {
  const seed = form.elements.avatarSeed.value.trim().toLowerCase();
  const button = form.querySelector("button[type='submit']");
  if (!/^[a-z0-9]{1,32}$/.test(seed)) {
    setMessage(dom.avatarMessage, "Use 1 to 32 lowercase letters or digits.", true);
    return;
  }

  setBusy(button, true);
  try {
    const { error } = await supabase.rpc("update_avatar_seed", { p_avatar_seed: seed });
    if (error) throw error;
    dom.avatarDialog.close();
    await refreshAll();
  } catch (error) {
    setMessage(dom.avatarMessage, error.message, true);
  } finally {
    setBusy(button, false);
  }
}

function bindEvents() {
  dom.loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const name = dom.coordinatorSelect.value;
    const password = dom.passwordInput.value;
    const submit = dom.loginForm.querySelector("button");
    setBusy(submit, true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: coordinatorEmail(name),
        password
      });
      if (error) throw error;
      dom.passwordInput.value = "";
      await refreshSession();
    } catch (error) {
      const text = /failed to fetch/i.test(error.message)
        ? "Cannot reach Supabase. Check coordination/config.js: the URL must be your real Project URL and the key must be the publishable/anon key."
        : error.message;
      alert(text);
    } finally {
      setBusy(submit, false);
    }
  });

  dom.avatarButton.addEventListener("click", () => {
    const nextHidden = !dom.avatarMenu.hidden;
    dom.avatarMenu.hidden = nextHidden;
    dom.avatarButton.setAttribute("aria-expanded", String(!nextHidden));
  });

  dom.changeAvatarButton.addEventListener("click", () => {
    dom.avatarMenu.hidden = true;
    dom.avatarButton.setAttribute("aria-expanded", "false");
    openAvatarDialog();
  });

  dom.signOutButton.addEventListener("click", async () => {
    dom.avatarMenu.hidden = true;
    await supabase.auth.signOut();
    unsubscribeMyPapersRealtime();
    currentUser = null;
    currentCoordinator = null;
    activePaperId = null;
    renderLogin();
  });

  dom.openClaimDialogButton.addEventListener("click", openClaimDialog);

  [
    ["claimDialogTeam", dom.claimTeamFilter],
    ["claimDialogProblem", dom.claimProblemFilter],
    ["claimDialogHelp", dom.claimHelpFilter]
  ].forEach(([key, control]) => {
    control.addEventListener("change", () => {
      setFilterState(key, control.value);
      claimDialogPage = 1;
      void renderClaimDialog();
    });
  });

  [
    ["claimedTeam", dom.claimedTeamFilter],
    ["claimedProblem", dom.claimedProblemFilter],
    ["gradedTeam", dom.gradedTeamFilter],
    ["gradedProblem", dom.gradedProblemFilter],
    ["coordinatedTeam", dom.coordinatedTeamFilter],
    ["coordinatedProblem", dom.coordinatedProblemFilter]
  ].forEach(([key, control]) => {
    control.addEventListener("change", () => {
      setFilterState(key, control.value);
      renderBoard();
    });
  });

  dom.avatarSeedInput.addEventListener("input", () => {
    dom.avatarSeedInput.value = dom.avatarSeedInput.value.toLowerCase().replace(/[^a-z0-9]/g, "");
    dom.avatarPreview.src = avatarUrl(dom.avatarSeedInput.value || "coordinator");
  });

  dom.randomAvatarSeedButton.addEventListener("click", () => {
    const seed = randomSeed();
    dom.avatarSeedInput.value = seed;
    dom.avatarPreview.src = avatarUrl(seed);
  });

  document.addEventListener("mouseover", event => {
    const target = event.target.closest(".has-tooltip[data-tooltip]");
    if (!target || !target.dataset.tooltip || target.contains(event.relatedTarget)) return;
    showBoundaryTooltip(target);
  });

  document.addEventListener("mouseout", event => {
    const target = event.target.closest(".has-tooltip[data-tooltip]");
    if (!target || target.contains(event.relatedTarget)) return;
    hideBoundaryTooltip(target);
  });

  document.addEventListener("focusin", event => {
    const target = event.target.closest(".has-tooltip[data-tooltip]");
    if (target && target.dataset.tooltip) showBoundaryTooltip(target);
  });

  document.addEventListener("focusout", event => {
    const target = event.target.closest(".has-tooltip[data-tooltip]");
    if (target) hideBoundaryTooltip(target);
  });

  window.addEventListener("resize", positionBoundaryTooltip);
  document.addEventListener("scroll", positionBoundaryTooltip, true);

  document.addEventListener("click", async event => {
    if (!dom.userMenu.hidden && !event.target.closest("#userMenu")) {
      dom.avatarMenu.hidden = true;
      dom.avatarButton.setAttribute("aria-expanded", "false");
    }

    const closeButton = event.target.closest(".close-dialog");
    if (closeButton) {
      closeButton.closest("dialog")?.close();
      return;
    }

    const pdfButton = event.target.closest(".open-paper-pdf");
    if (pdfButton && !pdfButton.disabled) {
      await openPaperPdf(pdfButton.dataset.paperId, pdfButton);
      return;
    }

    const claimButton = event.target.closest(".claim-paper");
    if (claimButton && !claimButton.disabled) {
      await claimPaper(claimButton.dataset.paperId, claimButton);
      return;
    }

    const claimPageButton = event.target.closest(".claim-page");
    if (claimPageButton && !claimPageButton.disabled) {
      claimDialogPage += Number(claimPageButton.dataset.pageDelta);
      void renderClaimDialog();
      return;
    }

    const releaseButton = event.target.closest(".release-claim");
    if (releaseButton) {
      const paper = paperById(releaseButton.dataset.paperId)
        || papers.find(item => item.active_claim_id === releaseButton.dataset.claimId);
      openConfirmAction({
        title: "Release claim?",
        paperLabel: paper ? formatCompactPaper(paper) : "Are you sure?",
        message: "This paper will become available for another coordinator to claim.",
        submitLabel: "Release",
        run: button => releaseClaim(releaseButton.dataset.claimId, button)
      });
      return;
    }

    const initialButton = event.target.closest(".open-initial-score");
    if (initialButton) {
      openInitialScoreDialog(initialButton.dataset.paperId);
      return;
    }

    const agreedButton = event.target.closest(".open-agreed-score");
    if (agreedButton) {
      openAgreedScoreDialog(agreedButton.dataset.paperId);
    }
  });

  dom.initialScoreForm.addEventListener("submit", async event => {
    event.preventDefault();
    await submitInitialScore(event.target);
  });

  dom.agreedScoreForm.addEventListener("submit", async event => {
    event.preventDefault();
    await submitAgreedScore(event.target);
  });

  dom.avatarForm.addEventListener("submit", async event => {
    event.preventDefault();
    await saveAvatarSeed(event.target);
  });

  dom.releaseConfirmForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.target.querySelector("button[type='submit']");
    if (!pendingConfirmAction) return;
    const ok = await pendingConfirmAction.run(button);
    if (ok) {
      pendingConfirmAction = null;
      dom.releaseConfirmDialog.close();
    }
  });
}

async function init() {
  initLoginOptions();
  if (!configureSupabase()) return;
  bindEvents();
  try {
    await refreshSession();
  } catch (error) {
    console.error(error);
    alert(error.message);
    renderLogin();
  }
}

init();
