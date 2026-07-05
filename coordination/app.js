import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const COORDINATORS = [
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
  claimStatusFilter: document.querySelector("#claimStatusFilter"),
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
let supabase = null;
let currentUser = null;
let currentCoordinator = null;
let papers = [];
let activePaperId = null;
let pendingConfirmAction = null;
let filterState = loadFilterState();

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

function randomSeed() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

function formatPaper(paper) {
  return `${paper.team_name} · ${paper.student_name} · P${paper.problem_id}`;
}

function formatPaperTitle(paper) {
  return `${paper.team_name} · ${paper.student_name} · P${paper.problem_id}`;
}

function scoreLabel(value) {
  return value === null || value === undefined ? "none" : String(value);
}

function setBusy(button, busy) {
  if (button) button.disabled = busy;
}

function setMessage(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function claimState(paper) {
  if (!paper.active_claim_id) return "unclaimed";
  if (paper.active_claim_coordinator_id === currentCoordinator.id) return "mine";
  return "other";
}

function paperById(paperId) {
  return papers.find(paper => paper.paper_id === paperId) || null;
}

function isIntegerScore(value) {
  return value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 7;
}

function initLoginOptions() {
  const coordinatorOptions = COORDINATORS.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
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
    currentCoordinator = null;
    renderLogin();
    return;
  }

  await loadCoordinator();
  await loadPapers();
  renderApp();
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

async function loadPapers() {
  const { data, error } = await supabase
    .from("paper_status")
    .select("*")
    .order("team_name", { ascending: true })
    .order("team_index", { ascending: true })
    .order("problem_id", { ascending: true });

  if (error) throw error;
  papers = data || [];
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
  const claimed = mine.filter(paper => paper.initial_score === null);
  const graded = mine.filter(paper => paper.initial_score !== null && paper.agreed_score === null);
  const coordinated = mine.filter(paper => paper.agreed_score !== null);
  return { claimed, graded, coordinated };
}

function renderBoard() {
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
  const actionClass = pile === "claimed" ? "open-initial-score" : "open-agreed-score";
  const buttonDisabled = pile !== "claimed" && claim === "other";
  const sideAction = renderCardSideAction(paper, pile, claim);
  const hoverScore = renderHoverScore(paper, pile);

  return `
    <article class="paper-card compact-card">
      <button class="paper-card-main ${actionClass}" type="button" data-paper-id="${paper.paper_id}" ${buttonDisabled ? "disabled" : ""}>
        <span>${escapeHtml(paper.team_name)}</span>
        <i>·</i>
        <strong>${escapeHtml(paper.student_name)}</strong>
        <i>·</i>
        <em>P${paper.problem_id}</em>
        ${hoverScore}
      </button>
      ${sideAction}
    </article>
  `;
}

function renderHoverScore(paper, pile) {
  if (pile === "graded") return `<b class="hover-score">${paper.initial_score}</b>`;
  if (pile === "coordinated") return `<b class="hover-score">${paper.agreed_score}</b>`;
  return "";
}

function renderCardSideAction(paper, pile, claim) {
  if (claim !== "mine") return "";
  if (pile === "claimed") {
    return `<button class="release-claim icon-button" type="button" data-claim-id="${paper.active_claim_id}" aria-label="Release ${escapeHtml(formatPaper(paper))}"></button>`;
  }
  if (pile === "graded") {
    return `<button class="back-paper clear-initial-score" type="button" data-paper-id="${paper.paper_id}" aria-label="Move ${escapeHtml(formatPaper(paper))} back to claimed">←</button>`;
  }
  if (pile === "coordinated") {
    return `<button class="back-paper clear-agreed-score" type="button" data-paper-id="${paper.paper_id}" aria-label="Move ${escapeHtml(formatPaper(paper))} back to graded">←</button>`;
  }
  return "";
}

function renderPileFilters() {
  const teams = [...new Set(papers.map(paper => paper.team_name))].sort((a, b) => a.localeCompare(b));
  [
    ["claimed", dom.claimedTeamFilter, dom.claimedProblemFilter],
    ["graded", dom.gradedTeamFilter, dom.gradedProblemFilter],
    ["coordinated", dom.coordinatedTeamFilter, dom.coordinatedProblemFilter]
  ].forEach(([key, teamFilter, problemFilter]) => {
    const currentTeam = filterState[`${key}Team`] ?? teamFilter.value;
    const currentProblem = filterState[`${key}Problem`] ?? problemFilter.value;
    teamFilter.innerHTML = [
      `<option value="">All</option>`,
      ...teams.map(team => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`)
    ].join("");
    problemFilter.innerHTML = [
      `<option value="">All</option>`,
      ...[1, 2, 3, 4, 5, 6].map(id => `<option value="${id}">P${id}</option>`)
    ].join("");
    teamFilter.value = teams.includes(currentTeam) ? currentTeam : "";
    problemFilter.value = ["1", "2", "3", "4", "5", "6"].includes(currentProblem) ? currentProblem : "";
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
  const teams = [...new Set(papers.map(paper => paper.team_name))].sort((a, b) => a.localeCompare(b));
  const current = filterState.claimDialogTeam ?? dom.claimTeamFilter.value;
  dom.claimTeamFilter.innerHTML = [
    `<option value="">All</option>`,
    ...teams.map(team => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`)
  ].join("");
  dom.claimTeamFilter.value = teams.includes(current) ? current : "";
  dom.claimProblemFilter.value = ["1", "2", "3", "4", "5", "6"].includes(filterState.claimDialogProblem)
    ? filterState.claimDialogProblem
    : "1";
  dom.claimStatusFilter.value = ["", "unclaimed"].includes(filterState.claimDialogStatus)
    ? filterState.claimDialogStatus
    : "unclaimed";
  filterState.claimDialogTeam = dom.claimTeamFilter.value;
  filterState.claimDialogProblem = dom.claimProblemFilter.value;
  filterState.claimDialogStatus = dom.claimStatusFilter.value;
  saveFilterState();
}

function filteredClaimPapers() {
  const team = dom.claimTeamFilter.value;
  const problem = dom.claimProblemFilter.value;
  const status = dom.claimStatusFilter.value;

  return papers.filter(paper => {
    if (team && paper.team_name !== team) return false;
    if (problem && String(paper.problem_id) !== problem) return false;
    if (status === "unclaimed" && claimState(paper) !== "unclaimed") return false;
    return true;
  });
}

function renderClaimDialog() {
  const visible = filteredClaimPapers();
  if (!visible.length) {
    dom.claimPaperList.innerHTML = `<div class="empty-state">No papers match these filters.</div>`;
    return;
  }

  dom.claimPaperList.innerHTML = visible.slice(0, 120).map(paper => {
    const claim = claimState(paper);
    const disabled = claim === "other" || claim === "mine";
    const label = claim === "mine" ? "Already claimed" : claim === "other" ? `Claimed by ${paper.active_claim_coordinator_name}` : "Claim";
    return `
      <article class="picker-row">
        <div>
          <strong>${escapeHtml(formatPaper(paper))}</strong>
        </div>
        <button class="claim-paper" type="button" data-paper-id="${paper.paper_id}" ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>
      </article>
    `;
  }).join("");
}

function openClaimDialog() {
  renderClaimDialog();
  dom.claimDialog.showModal();
}

function openInitialScoreDialog(paperId) {
  const paper = paperById(paperId);
  if (!paper) return;
  activePaperId = paperId;
  dom.initialScorePaper.textContent = formatPaperTitle(paper);
  dom.initialScoreForm.reset();
  setMessage(dom.initialScoreMessage, "");
  dom.initialScoreDialog.showModal();
  dom.initialScoreForm.elements.score.focus();
}

function openAgreedScoreDialog(paperId) {
  const paper = paperById(paperId);
  if (!paper) return;
  activePaperId = paperId;
  dom.agreedScorePaper.textContent = formatPaper(paper);
  dom.agreedScoreForm.reset();
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
  await loadPapers();
  renderApp();
  if (dom.claimDialog.open) renderClaimDialog();
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

async function clearAgreedScore(paperId, button) {
  setBusy(button, true);
  try {
    const { error } = await supabase.rpc("clear_agreed_score", { p_paper_id: paperId });
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
  const signature = form.elements.signature.value.trim();
  const button = form.querySelector("button[type='submit']");
  if (!signature) {
    setMessage(dom.agreedScoreMessage, "Team leader signature is required.", true);
    return;
  }
  if (!isIntegerScore(scoreValue)) {
    setMessage(dom.agreedScoreMessage, "Enter an integer score from 0 to 7.", true);
    return;
  }

  setBusy(button, true);
  try {
    const { error } = await supabase.rpc("submit_agreed_score", {
      p_paper_id: activePaperId,
      p_score: Number(scoreValue),
      p_team_leader_signature: signature
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
    currentUser = null;
    currentCoordinator = null;
    activePaperId = null;
    renderLogin();
  });

  dom.openClaimDialogButton.addEventListener("click", openClaimDialog);

  [
    ["claimDialogTeam", dom.claimTeamFilter],
    ["claimDialogProblem", dom.claimProblemFilter],
    ["claimDialogStatus", dom.claimStatusFilter]
  ].forEach(([key, control]) => {
    control.addEventListener("change", () => {
      setFilterState(key, control.value);
      renderClaimDialog();
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

    const claimButton = event.target.closest(".claim-paper");
    if (claimButton && !claimButton.disabled) {
      await claimPaper(claimButton.dataset.paperId, claimButton);
      return;
    }

    const releaseButton = event.target.closest(".release-claim");
    if (releaseButton) {
      const paper = papers.find(item => item.active_claim_id === releaseButton.dataset.claimId);
      openConfirmAction({
        title: "Release claim?",
        paperLabel: paper ? formatPaper(paper) : "Are you sure?",
        message: "This paper will become available for another coordinator to claim.",
        submitLabel: "Release",
        run: button => releaseClaim(releaseButton.dataset.claimId, button)
      });
      return;
    }

    const clearInitialButton = event.target.closest(".clear-initial-score");
    if (clearInitialButton) {
      const paper = paperById(clearInitialButton.dataset.paperId);
      openConfirmAction({
        title: "Move back to Claimed?",
        paperLabel: paper ? formatPaper(paper) : "Are you sure?",
        message: "This will remove the current initial score and send the paper back to Claimed.",
        submitLabel: "Move back",
        run: button => clearInitialScore(clearInitialButton.dataset.paperId, button)
      });
      return;
    }

    const clearAgreedButton = event.target.closest(".clear-agreed-score");
    if (clearAgreedButton) {
      const paper = paperById(clearAgreedButton.dataset.paperId);
      openConfirmAction({
        title: "Move back to Graded?",
        paperLabel: paper ? formatPaper(paper) : "Are you sure?",
        message: "This will remove the current agreed score and send the paper back to Graded.",
        submitLabel: "Move back",
        run: button => clearAgreedScore(clearAgreedButton.dataset.paperId, button)
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
