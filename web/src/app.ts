import { attachProjections, isStarter, normName, canonTeam, rank } from "./core.ts";
import type { Player, RankedGame, Ranking, Scoring } from "./core.ts";
import { age, fetchBundle, fetchManifest } from "./data.ts";
import type { Bundle, OffSeasonManifest } from "./data.ts";
import { parseLineup } from "./lineup.ts";
import type { LineupIssue, LineupPlayer } from "./lineup.ts";
import {
  confirmRoster, decodeShare, emptyRoster, encodeShare, loadRoster, needsReview, resolveRoster, saveRoster, teamChanges, weekKey,
} from "./roster.ts";
import type { Roster } from "./roster.ts";
import { buildIndex, searchPlayers } from "./search.ts";
import type { SearchIndexEntry } from "./search.ts";
import { TEAM_COLORS, headshotUrl, logoUrl } from "./teams.ts";

const DATA_BASE = "data/";
const STALE_AFTER_HOURS = 24;
const SCORING_LABEL: Record<Scoring, string> = { std: "Standard", half: "Half-PPR", ppr: "PPR" };
const SCORING_BOARD: Record<Scoring, string> = { std: "STD", half: "½ PPR", ppr: "PPR" };
const EXAMPLE_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "BN", "BN"];

const storage = (() => {
  try { return window.localStorage; } catch { return undefined; }
})();

let bundle: Bundle | null = null;
let offSeason: OffSeasonManifest | null = null;
let index: SearchIndexEntry[] = [];
let roster: Roster = emptyRoster();
let viewingShared = false;
let pasteIssues: LineupIssue[] = [];
let options: SearchIndexEntry[] = [];
let activeOption = -1;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function addImage(parent: HTMLElement, url: string | null, className: string): void {
  if (!url) return;
  const img = el("img", undefined, className);
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => img.remove(), { once: true });
  img.src = url;
  parent.prepend(img);
}

function points(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1);
}

// ---------------------------------------------------------------- lineup editor

/** Every saved edit also confirms the lineup for the week on screen. */
function commit(next: Roster, keep = true): void {
  roster = keep && bundle ? confirmRoster(next, bundle.directory, weekKey(bundle.manifest.season, bundle.manifest.week)) : next;
  if (keep) {
    viewingShared = false;
    saveRoster(storage, roster);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }
  render();
}

function addPlayer(id: string, slot: string): void {
  if (roster.entries.some((e) => e.id === id)) return;
  commit({ ...roster, entries: [...roster.entries, { id, slot }] });
}

function renderRoster(players: LineupPlayer[]): void {
  const list = $("roster");
  list.replaceChildren();
  for (const player of players) {
    const row = el("li", undefined, "roster-row");
    const info = el("div", undefined, "player-info");
    info.append(el("span", player.name, "player-name"), el("span", `${player.team || "FA"} · ${player.pos}`, "meta"));
    const starting = isStarter(player);
    const toggle = el("button", starting ? "Starting" : "Bench", "secondary toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", String(starting));
    toggle.setAttribute("aria-label", `${player.name}: ${starting ? "starting, move to bench" : "on bench, move to starters"}`);
    toggle.addEventListener("click", () => commit({
      ...roster,
      entries: roster.entries.map((e) => (e.id === player.id ? { ...e, slot: starting ? "BN" : player.pos } : e)),
    }));
    const remove = el("button", "×", "secondary remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${player.name}`);
    remove.addEventListener("click", () => commit({ ...roster, entries: roster.entries.filter((e) => e.id !== player.id) }));
    row.append(info, toggle, remove);
    list.append(row);
  }
  $("roster-empty").hidden = players.length > 0;
  $("clear").hidden = players.length === 0;
  const starters = players.filter(isStarter).length;
  $("editor-summary").textContent = players.length
    ? `Your lineup · ${starters} starting, ${players.length - starters} bench · ${SCORING_LABEL[roster.scoring]}`
    : "Set your lineup";
}

function closeOptions(): void {
  options = [];
  activeOption = -1;
  $("search-results").replaceChildren();
  $("search-results").hidden = true;
  $("search").setAttribute("aria-expanded", "false");
  $("search").removeAttribute("aria-activedescendant");
}

function renderOptions(): void {
  const list = $("search-results");
  list.replaceChildren();
  options.forEach((option, i) => {
    const item = el("li", undefined, "option" + (i === activeOption ? " active" : ""));
    item.id = `option-${i}`;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(i === activeOption));
    item.append(el("span", option.entry.name, "player-name"), el("span", `${option.entry.team} · ${option.entry.position}`, "meta"));
    // mousedown fires before the input loses focus, so the list is still open.
    item.addEventListener("mousedown", (event) => { event.preventDefault(); choose(i); });
    list.append(item);
  });
  list.hidden = options.length === 0;
  $("search").setAttribute("aria-expanded", String(options.length > 0));
  if (activeOption >= 0) $("search").setAttribute("aria-activedescendant", `option-${activeOption}`);
  else $("search").removeAttribute("aria-activedescendant");
}

function choose(i: number): void {
  const option = options[i];
  if (!option) return;
  addPlayer(option.id, $<HTMLInputElement>("add-to-bench").checked ? "BN" : option.entry.position);
  $<HTMLInputElement>("search").value = "";
  closeOptions();
  $("search").focus();
}

function wireSearch(): void {
  const search = $<HTMLInputElement>("search");
  search.addEventListener("input", () => {
    const taken = new Set(roster.entries.map((e) => e.id));
    options = searchPlayers(index, search.value, 12).filter((o) => !taken.has(o.id)).slice(0, 8);
    activeOption = options.length ? 0 : -1;
    renderOptions();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      activeOption = (activeOption + step + options.length) % options.length;
      renderOptions();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === "Escape") {
      closeOptions();
    }
  });
  search.addEventListener("blur", closeOptions);
}

function importPaste(): void {
  if (!bundle) return;
  const parsed = parseLineup($<HTMLTextAreaElement>("paste").value, bundle.directory);
  pasteIssues = parsed.issues;
  const known = new Set(roster.entries.map((e) => e.id));
  const added = parsed.players.filter((p) => !known.has(p.id)).map((p) => ({ id: p.id, slot: p.slot === "STARTER" ? p.pos : p.slot }));
  if (added.length) $<HTMLTextAreaElement>("paste").value = "";
  commit({ ...roster, entries: [...roster.entries, ...added] });
}

function exampleRoster(data: Bundle): Roster {
  const ids = new Map<string, string>();
  for (const [id, entry] of Object.entries(data.directory)) ids.set(`${normName(entry.name)}|${entry.team}`, id);
  const best = [...data.projections].sort((a, b) => Number(b.stats.points ?? 0) - Number(a.stats.points ?? 0));
  const entries: Roster["entries"] = [];
  for (const slot of EXAMPLE_SLOTS) {
    const row = best.find((r) => {
      const id = ids.get(`${normName(r.name)}|${canonTeam(r.team_id)}`);
      const fits = slot === "BN" ? r.position_id === "WR" || r.position_id === "RB" : r.position_id === slot;
      return fits && id !== undefined && !entries.some((e) => e.id === id);
    });
    if (row) entries.push({ id: ids.get(`${normName(row.name)}|${canonTeam(row.team_id)}`)!, slot });
  }
  return { ...roster, entries };
}

// --------------------------------------------------------------------- results

function playerList(players: Player[], data: Bundle, bench = false): HTMLElement {
  const list = el("ul", undefined, "players" + (bench ? " bench" : ""));
  for (const player of players as LineupPlayer[]) {
    const row = el("li", undefined, "player");
    const portrait = el("div", undefined, "portrait");
    const color = TEAM_COLORS[player.team];
    if (color) portrait.style.setProperty("--team-color", color);
    portrait.append(el("span", player.jersey != null ? `#${player.jersey}` : player.pos, "number"));
    if (data.manifest.media.headshots) addImage(portrait, headshotUrl(player.id), "headshot");
    else if (data.manifest.media.logos && player.pos === "DST") addImage(portrait, logoUrl(player.team), "headshot logo");
    const info = el("div", undefined, "player-info");
    const slot = player.slot === player.pos ? "" : ` · ${player.slot}`;
    info.append(el("span", player.name, "player-name"), el("span", `${player.team} · ${player.pos}${slot}`, "meta"));
    row.append(portrait, info, el("span", points(player.proj), "value"));
    list.append(row);
  }
  return list;
}

function teamBadge(team: string, data: Bundle): HTMLElement {
  const badge = el("span", undefined, "team-badge");
  badge.append(el("span", team));
  if (data.manifest.media.logos) addImage(badge, logoUrl(team), "team-logo");
  return badge;
}

function kickoffText(game: RankedGame): string {
  const time = new Date(game.kick).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const state = game.status === "STATUS_FINAL" ? "Final" : Date.parse(game.kick) < Date.now() ? "Kicked off" : "";
  return [time, game.network, state].filter(Boolean).join(" · ");
}

function gameCard(game: RankedGame, featured: boolean, data: Bundle): HTMLElement {
  const over = game.status === "STATUS_FINAL";
  const card = el("article", undefined, "game" + (featured ? " featured" : "") + (over ? " over" : ""));
  if (featured) {
    const strip = el("div", undefined, "game-strip");
    strip.append(el("span", "First on your dial"), el("span", game.starters.length ? "Starters in play" : "Bench only"));
    card.append(strip);
  }
  const head = el("div", undefined, "game-head");
  const title = el("div");
  const heading = el("h4", undefined, "matchup-title");
  heading.append(teamBadge(game.away, data), el("span", "at", "versus"), teamBadge(game.home, data));
  title.append(heading, el("div", kickoffText(game), "kick"));
  const total = el("div", undefined, "points");
  const count = game.starters.length;
  total.append(el("strong", points(game.starter_pts)), el("small", `${count} starter${count === 1 ? "" : "s"} · proj. pts`));
  head.append(title, total);
  card.append(head);
  if (game.starters.length) card.append(playerList(game.starters, data));
  if (game.bench.length) card.append(el("p", "On the bench · tiebreak only", "bench-label"), playerList(game.bench, data, true));
  return card;
}

function renderResults(ranking: Ranking, data: Bundle): void {
  const results = $("results");
  results.replaceChildren();
  for (const window of ranking.windows) {
    const section = el("section", undefined, "slot");
    section.append(el("h3", window.label, "slot-title"));
    const mine = window.games.filter((g) => g.starters.length || g.bench.length);
    mine.forEach((game, i) => section.append(gameCard(game, i === 0, data)));
    const others = window.games.filter((g) => !mine.includes(g)).map((g) => `${g.away} at ${g.home}`);
    if (others.length) section.append(el("p", `${mine.length ? "Also on" : "None of your players"}: ${others.join(", ")}`, "other-games"));
    results.append(section);
  }
  if (ranking.idle.length) {
    const idle = el("section", undefined, "slot");
    idle.append(el("h3", "Not playing this week", "slot-title"), playerList(ranking.idle, data));
    results.append(idle);
  }
}

function renderStatus(data: Bundle): void {
  const { manifest } = data;
  const updated = age(manifest.projections.fetched_at ?? manifest.generated_at);
  const status = $("status");
  status.replaceChildren(el("span", `Week ${manifest.week} · ${manifest.season} · ${SCORING_LABEL[roster.scoring]}`));
  const chip = el("span", undefined, "chip");
  if (manifest.demo) chip.textContent = "Example data · not real projections";
  else chip.textContent = `${manifest.projections.attribution ?? "Projections"} · updated ${updated?.text ?? "at an unknown time"}`;
  if (!manifest.demo && (!updated || updated.hours > STALE_AFTER_HOURS)) chip.classList.add("stale");
  status.append(chip);
}

function noticeBox(title: string, lines: string[], action?: HTMLButtonElement): HTMLElement {
  const notice = el("div", undefined, "notice");
  notice.append(el("strong", title));
  if (lines.length) {
    const list = el("ul");
    for (const text of lines) list.append(el("li", text));
    notice.append(list);
  }
  if (action) notice.append(action);
  return notice;
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", label, "secondary");
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function renderNotices(ranking: Ranking, missing: number, data: Bundle): void {
  const box = $("issues");
  box.replaceChildren();
  if (viewingShared) {
    box.append(noticeBox("You’re viewing a shared lineup.", ["It isn’t saved on this device."],
      actionButton("Keep this lineup", () => commit(roster))));
  } else if (needsReview(roster, weekKey(data.manifest.season, data.manifest.week))) {
    const flags = teamChanges(roster, data.directory).map((c) => `${c.name} moved from ${c.from} to ${c.to}.`);
    if (ranking.idle.length) flags.push(`Not playing this week: ${ranking.idle.map((p) => p.name).join(", ")}.`);
    box.append(noticeBox(`It’s Week ${data.manifest.week}. Is this still your lineup?`, flags,
      actionButton("Looks right", () => commit(roster))));
  }

  const notices = pasteIssues.map((i) => `Line ${i.line}: “${i.text}” — ${i.message}`);
  if (ranking.unmatched.length) notices.push(`No projection for ${ranking.unmatched.map((p) => p.name).join(", ")}. Totals include known points only.`);
  if (missing) notices.push(`${missing} saved player${missing === 1 ? " is" : "s are"} no longer in the player list and ${missing === 1 ? "was" : "were"} left out.`);
  if (notices.length) box.append(noticeBox("Check your lineup", notices));
}

/** Nothing to rank: say so, and leave the saved lineup untouched for next season. */
function renderOffSeason(manifest: OffSeasonManifest): void {
  $("board-season").textContent = String(manifest.season);
  $("status").textContent = manifest.phase === "pre"
    ? `The ${manifest.season} regular season hasn’t started. Matchups appear once Week 1 is scheduled.`
    : `The ${manifest.season} fantasy regular season is over. See you next season.`;
  $("placeholder-title").textContent = manifest.phase === "pre" ? "Almost kickoff." : "See you next season.";
  $("placeholder-text").textContent = roster.entries.length
    ? "Your saved lineup is still here and will be ready when the games are."
    : "Come back when the regular season is under way.";
  $("placeholder").hidden = false;
  $("share").hidden = true;
  $("results").replaceChildren();
  $("issues").replaceChildren();
  $("controls").hidden = true;
}

function render(): void {
  $("board-scoring").textContent = SCORING_BOARD[roster.scoring];
  $<HTMLSelectElement>("scoring").value = roster.scoring;
  if (offSeason) return renderOffSeason(offSeason);
  if (!bundle) return;
  $("controls").hidden = false;
  $("board-week").textContent = String(bundle.manifest.week).padStart(2, "0");
  $("board-season").textContent = String(bundle.manifest.season);
  const { players, missing } = resolveRoster(roster, bundle.directory);
  renderRoster(players);
  renderStatus(bundle);
  attachProjections(players, bundle.projections, roster.scoring);
  const ranking = rank(players, bundle.schedule);
  renderNotices(ranking, missing.length, bundle);
  const hasPlayers = players.length > 0;
  $("placeholder").hidden = hasPlayers;
  $("share").hidden = !hasPlayers;
  if (hasPlayers) renderResults(ranking, bundle);
  else $("results").replaceChildren();
}

// ------------------------------------------------------------------------ start

function use(loaded: Bundle | OffSeasonManifest): void {
  if ("manifest" in loaded) {
    [bundle, offSeason] = [loaded, null];
    index = buildIndex(loaded.directory);
    $<HTMLInputElement>("search").disabled = false;
  } else {
    [bundle, offSeason] = [null, loaded];
  }
}

async function load(): Promise<void> {
  try {
    use(await fetchBundle(DATA_BASE));
  } catch {
    $("status").textContent = "This week’s data isn’t available right now. Please try again shortly.";
    return;
  }
  render();
}

/** Pick up a newer bundle when the tab is looked at again, without a reload. */
async function refreshIfNewer(): Promise<void> {
  const shown = bundle?.manifest ?? offSeason;
  if (document.visibilityState !== "visible" || !shown) return;
  try {
    const manifest = await fetchManifest(DATA_BASE);
    if (manifest.generated_at === shown.generated_at) return;
    use(await fetchBundle(DATA_BASE, manifest));
  } catch {
    // Keep showing the bundle already loaded; its age is on screen.
  }
  render();
}

function openSharedLineup(): boolean {
  const shared = decodeShare(location.hash);
  if (!shared) return false;
  roster = shared;
  viewingShared = true;
  return true;
}

function start(): void {
  if (!openSharedLineup()) roster = loadRoster(storage) ?? emptyRoster();
  // On a phone the editor sits above the results; fold it away once a lineup exists.
  $<HTMLDetailsElement>("editor").open = !(roster.entries.length && window.matchMedia("(max-width: 780px)").matches);

  wireSearch();
  $("scoring").addEventListener("change", () => commit({ ...roster, scoring: $<HTMLSelectElement>("scoring").value as Scoring }, !viewingShared));
  $("paste-add").addEventListener("click", importPaste);
  $("example").addEventListener("click", () => { if (bundle) commit(exampleRoster(bundle)); });
  $("clear").addEventListener("click", () => { pasteIssues = []; commit({ ...roster, entries: [] }); });
  $("share").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#${encodeShare(roster)}`;
    try {
      await navigator.clipboard.writeText(url);
      $("share-status").textContent = "Link copied. Anyone with it can see this lineup.";
    } catch {
      history.replaceState(null, "", url);
      $("share-status").textContent = "The link is in your address bar. Anyone with it can see this lineup.";
    }
  });
  document.addEventListener("visibilitychange", () => void refreshIfNewer());
  window.addEventListener("hashchange", () => { if (openSharedLineup()) render(); });
  render();
  void load();
}

start();
