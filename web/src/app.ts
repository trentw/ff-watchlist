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
import { SleeperError, findAccount, importLineup, loadSource, saveSource } from "./sleeper.ts";
import type { SleeperLeague, SleeperSource } from "./sleeper.ts";
import type { SearchIndexEntry } from "./search.ts";
import { TEAM_COLORS, headshotUrl, logoUrl } from "./teams.ts";
import { connect as connectYahoo, disconnect as disconnectYahoo, fetchRoster as fetchYahooRoster, loadYahooSource, mapRoster, saveYahooSource, session as yahooSession, teams as yahooTeams, YahooImportError } from "./yahoo.ts";
import type { YahooSource, YahooTeam } from "./yahoo.ts";

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
let sleeperSource: SleeperSource | null = null;
let yahooSource: YahooSource | null = null;
let yahooConnected = false;
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

// --------------------------------------------------------------- Sleeper import

function renderSleeperSource(): void {
  const update = $("sleeper-update");
  update.hidden = sleeperSource === null;
  if (!sleeperSource) return;
  update.textContent = `Update from Sleeper · ${sleeperSource.leagueName}`;
  const when = age(sleeperSource.importedAt)?.text ?? "earlier";
  if (!$("sleeper-status").textContent) $("sleeper-status").textContent = `Imported from ${sleeperSource.leagueName} ${when}.`;
}

async function importFrom(account: { userId: string; username: string }, league: SleeperLeague): Promise<void> {
  if (!bundle) return;
  const lineup = await importLineup({ userId: account.userId, league }, bundle.manifest.week, bundle.directory);
  sleeperSource = {
    username: account.username, userId: account.userId,
    leagueId: league.id, leagueName: league.name, importedAt: new Date().toISOString(),
  };
  saveSource(storage, sleeperSource);
  yahooSource = null;
  saveYahooSource(storage, null);
  pasteIssues = [];
  const notes = [`Imported ${lineup.entries.length} players from ${league.name}.`];
  notes.push(lineup.scoringIsPreset
    ? `Scoring set to ${SCORING_LABEL[lineup.scoring]}; other custom league scoring isn’t applied.`
    : `This league gives ${league.pointsPerReception} per reception; showing the nearest preset, ${SCORING_LABEL[lineup.scoring]}.`);
  if (lineup.skipped) notes.push(`${lineup.skipped} player${lineup.skipped === 1 ? "" : "s"} at positions without projections ${lineup.skipped === 1 ? "was" : "were"} left out.`);
  $("sleeper-status").textContent = notes.join(" ");
  $("sleeper-leagues").replaceChildren();
  $<HTMLDetailsElement>("sleeper").open = false;
  commit({ ...roster, scoring: lineup.scoring, entries: lineup.entries });
}

// ---------------------------------------------------------------- Yahoo import

function renderYahooSource(): void {
  const update = $("yahoo-update");
  update.hidden = !yahooSource || !yahooConnected;
  if (yahooSource) update.textContent = `Update from Yahoo · ${yahooSource.teamName}`;
}

function yahooStatus(message: string): void { $("yahoo-status").textContent = message; }

async function yahooStep(step: () => Promise<void>): Promise<void> {
  const buttons = ["yahoo-connect", "yahoo-find", "yahoo-disconnect", "yahoo-update"].map((id) => $<HTMLButtonElement>(id));
  buttons.forEach((button) => { button.disabled = true; });
  try { await step(); }
  catch (error) { yahooStatus(error instanceof YahooImportError ? error.message : "Yahoo import couldn't finish. Your lineup is unchanged."); }
  finally { buttons.forEach((button) => { button.disabled = false; }); }
}

async function yahooConnection(): Promise<void> {
  const result = await yahooSession().catch(() => ({ enabled: false, connected: false }));
  yahooConnected = result.connected;
  $("yahoo").hidden = !result.enabled;
  $("yahoo-privacy").hidden = !result.enabled;
  $("yahoo-connect").hidden = !result.enabled || result.connected;
  $("yahoo-find").hidden = !result.connected;
  $("yahoo-disconnect").hidden = !result.connected;
  renderYahooSource();
  if (!result.enabled) yahooStatus("");
  else if (result.connected) yahooStatus(yahooSource ? "" : "Yahoo is connected. Choose a team to import.");
  else yahooStatus("Connect Yahoo to import one of your fantasy teams.");
}

async function importYahooTeam(team: YahooTeam | YahooSource): Promise<void> {
  if (!bundle) return;
  yahooStatus("Reading this week's Yahoo roster…");
  const teamKey = "key" in team ? team.key : team.teamKey;
  const result = await fetchYahooRoster(teamKey, bundle.manifest.season, bundle.manifest.week);
  if (!bundle || result.season !== bundle.manifest.season || result.week !== bundle.manifest.week) throw new YahooImportError("The displayed week changed. Reload before importing.");
  const mapped = mapRoster(result, bundle.directory);
  if (!mapped.entries.length) throw new YahooImportError("No Yahoo players matched the Watchlist player list. Your lineup is unchanged.");
  const scoring = mapped.suggestedScoring ?? roster.scoring;
  yahooSource = { teamKey: result.team.key, teamName: result.team.name, leagueName: result.team.leagueName, importedAt: result.fetchedAt };
  saveYahooSource(storage, yahooSource);
  sleeperSource = null;
  saveSource(storage, null);
  $("yahoo-teams").replaceChildren();
  $<HTMLDetailsElement>("yahoo").open = false;
  commit({ ...roster, entries: mapped.entries, scoring });
  yahooStatus(`Imported ${mapped.entries.length} players from ${result.team.leagueName}. ${mapped.issues.length ? `${mapped.issues.length} could not be matched and were left out. ` : ""}${mapped.suggestedScoring ? `Scoring set to ${SCORING_LABEL[scoring]}; other league rules are not applied.` : `Kept ${SCORING_LABEL[scoring]} scoring because this league's reception setting is custom or unknown.`}`);
}

async function findYahooTeams(): Promise<void> {
  if (!bundle) return;
  yahooStatus("Finding your Yahoo teams…");
  const found = await yahooTeams();
  const list = $("yahoo-teams");
  list.replaceChildren();
  for (const team of found) {
    const button = el("button", `${team.leagueName} · ${team.name}`, "secondary");
    button.type = "button";
    button.addEventListener("click", () => void yahooStep(() => importYahooTeam(team)));
    list.append(el("li"));
    list.lastElementChild!.append(button);
  }
  yahooStatus(found.length ? `Choose a team to import.${roster.entries.length ? " It replaces the lineup you have now." : ""}` : "No Yahoo NFL teams were found for the displayed season.");
}

function wireYahoo(): void {
  $("yahoo").addEventListener("toggle", () => { if ($<HTMLDetailsElement>("yahoo").open) void yahooStep(yahooConnection); });
  $("yahoo-connect").addEventListener("click", () => void yahooStep(async () => {
    try { sessionStorage.setItem("ff-watchlist.yahoo-return-hash", location.hash); } catch { /* Optional view restoration. */ }
    location.assign(await connectYahoo());
  }));
  $("yahoo-find").addEventListener("click", () => void yahooStep(findYahooTeams));
  $("yahoo-update").addEventListener("click", () => void yahooStep(async () => { if (yahooSource) await importYahooTeam(yahooSource); }));
  $("yahoo-disconnect").addEventListener("click", () => void yahooStep(async () => {
    await disconnectYahoo();
    yahooConnected = false;
    yahooSource = null;
    saveYahooSource(storage, null);
    $("yahoo-teams").replaceChildren();
    await yahooConnection();
    yahooStatus("Yahoo disconnected. Your current lineup remains in this browser.");
  }));
}

/** Run one Sleeper step with the buttons disabled, turning failures into a message. */
async function withSleeper(step: () => Promise<void>): Promise<void> {
  const buttons = [$<HTMLButtonElement>("sleeper-find"), $<HTMLButtonElement>("sleeper-update")];
  buttons.forEach((b) => (b.disabled = true));
  $("sleeper-status").textContent = "Asking Sleeper…";
  try {
    await step();
  } catch (error) {
    $("sleeper-status").textContent = error instanceof SleeperError ? error.message : "Couldn’t reach Sleeper. Please try again.";
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function wireSleeper(): void {
  const username = $<HTMLInputElement>("sleeper-username");
  const find = () => withSleeper(async () => {
    if (!bundle) return;
    const account = await findAccount(username.value, bundle.manifest.season);
    const list = $("sleeper-leagues");
    list.replaceChildren();
    for (const league of account.leagues) {
      const choose = el("button", undefined, "secondary");
      choose.type = "button";
      choose.append(el("span", league.name), el("span", `${league.teams} teams`, "meta"));
      choose.addEventListener("click", () => void withSleeper(() => importFrom(account, league)));
      const item = el("li");
      item.append(choose);
      list.append(item);
    }
    $("sleeper-status").textContent = account.leagues.length
      ? `Choose a league.${roster.entries.length ? " It replaces the lineup you have now." : ""}`
      : `${account.username} has no ${bundle.manifest.season} leagues on Sleeper.`;
  });
  $("sleeper-find").addEventListener("click", () => void find());
  username.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void find(); } });
  $("sleeper-update").addEventListener("click", () => void withSleeper(async () => {
    if (!bundle || !sleeperSource) return;
    const source = sleeperSource;
    const account = await findAccount(source.username, bundle.manifest.season);
    const league = account.leagues.find((l) => l.id === source.leagueId);
    if (!league) throw new SleeperError(`${source.leagueName} is no longer among your leagues.`);
    await importFrom(account, league);
  }));
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
    if (player.pos === "DST") {
      if (data.manifest.media.logos) addImage(portrait, logoUrl(player.team), "headshot logo");
    } else if (data.manifest.media.headshots) {
      addImage(portrait, headshotUrl(player.id), "headshot");
    }
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
  renderSleeperSource();
  renderYahooSource();
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

  sleeperSource = loadSource(storage);
  yahooSource = loadYahooSource(storage);
  if (sleeperSource) $<HTMLInputElement>("sleeper-username").value = sleeperSource.username;
  wireSearch();
  wireSleeper();
  wireYahoo();
  const yahooOutcome = new URL(location.href).searchParams.get("yahoo");
  if (yahooOutcome) {
    const clean = new URL(location.href);
    clean.searchParams.delete("yahoo");
    try { clean.hash = sessionStorage.getItem("ff-watchlist.yahoo-return-hash") ?? clean.hash; sessionStorage.removeItem("ff-watchlist.yahoo-return-hash"); } catch { /* Storage may be blocked. */ }
    history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
    $<HTMLDetailsElement>("yahoo").open = true;
  }
  void yahooStep(yahooConnection);
  $("scoring").addEventListener("change", () => commit({ ...roster, scoring: $<HTMLSelectElement>("scoring").value as Scoring }, !viewingShared));
  $("paste-add").addEventListener("click", importPaste);
  $("example").addEventListener("click", () => { if (bundle) commit(exampleRoster(bundle)); });
  $("clear").addEventListener("click", () => {
    pasteIssues = [];
    sleeperSource = null;
    saveSource(storage, null);
    yahooSource = null;
    saveYahooSource(storage, null);
    $("sleeper-status").textContent = "";
    commit({ ...roster, entries: [] });
  });
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
