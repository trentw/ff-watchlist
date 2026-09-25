import { attachProjections, isStarter, normName, canonTeam, rank } from "./core.ts";
import type { KickoffWindow, Player, RankedGame, Ranking, Scoring } from "./core.ts";
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

const DATA_BASE = "data/";
const STALE_AFTER_HOURS = 24;
const SCORING_LABEL: Record<Scoring, string> = { std: "Standard", half: "Half-PPR", ppr: "PPR" };
const SCORING_BOARD: Record<Scoring, string> = { std: "STD", half: "HALF-PPR", ppr: "PPR" };
/** A real league's lineup, by player ID and slot, for "Try an example lineup". */
const EXAMPLE_LINEUP: [string, string][] = [
  ["3163", "QB"], ["7588", "RB"], ["11584", "RB"], ["8150", "RB"], ["7564", "WR"], ["12514", "WR"], ["5012", "TE"],
  ["11539", "K"], ["SF", "DST"], ["11560", "BN"], ["11586", "BN"], ["7567", "BN"], ["11620", "BN"], ["5872", "BN"],
  ["5859", "BN"], ["4217", "BN"],
];
/** Fallback when those players are missing, as in the offline demo data. */
const EXAMPLE_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "BN", "BN"];
const SHARE_NOTE_MS = 5000;

type Method = "search" | "sleeper" | "paste";

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
let options: SearchIndexEntry[] = [];
let activeOption = -1;
let method: Method = "search";

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** Prepend an optional image; it removes itself, and calls `onFail`, if it cannot load. */
function addImage(parent: HTMLElement, url: string | null, className: string, onFail?: () => void): boolean {
  if (!url) return false;
  const img = el("img", undefined, className);
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => { img.remove(); onFail?.(); }, { once: true });
  img.src = url;
  parent.prepend(img);
  return true;
}

/** Color an element with a team's primary color and a readable text color on it. */
function teamColors(node: HTMLElement, team: string): void {
  const color = TEAM_COLORS[team];
  if (!color) return;
  node.style.setProperty("--team-color", color);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number];
  if (0.299 * r + 0.587 * g + 0.114 * b > 0.6) node.style.setProperty("--team-ink", "#1d1a17");
}

function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const ICONS = {
  down: ["M12 5v14", "M5 12l7 7 7-7"],
  up: ["M12 19V5", "M5 12l7-7 7 7"],
  remove: ["M18 6 6 18", "M6 6l12 12"],
  info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 11v5", "M12 8h.01"],
  alert: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v6", "M12 16.5h.01"],
};

function iconButton(paths: string[], label: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", undefined, "icon");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon(paths));
  button.addEventListener("click", onClick);
  return button;
}

function jerseyText(player: Player): string {
  return player.jersey ? `#${player.jersey}` : player.pos;
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
  const lists = { starters: $("roster-starters"), bench: $("roster-bench") };
  lists.starters.replaceChildren();
  lists.bench.replaceChildren();
  for (const player of players) {
    const starting = isStarter(player);
    const row = el("li", undefined, "roster-row");
    const chip = el("span", jerseyText(player), "chip");
    chip.setAttribute("aria-hidden", "true");
    teamColors(chip, player.team);
    const info = el("span", undefined, "player-info");
    info.append(el("span", player.name, "player-name"), el("span", `${player.team || "FA"} · ${player.pos}`, "meta"));
    const move = iconButton(starting ? ICONS.down : ICONS.up, `Move ${player.name} to ${starting ? "the bench" : "starters"}`, () => commit({
      ...roster,
      entries: roster.entries.map((e) => (e.id === player.id ? { ...e, slot: starting ? "BN" : player.pos } : e)),
    }));
    const remove = iconButton(ICONS.remove, `Remove ${player.name}`, () => commit({ ...roster, entries: roster.entries.filter((e) => e.id !== player.id) }));
    row.append(chip, info, move, remove);
    (starting ? lists.starters : lists.bench).append(row);
  }
  const starters = players.filter(isStarter).length;
  const bench = players.length - starters;
  $("roster-groups").hidden = players.length === 0;
  $("bench-label").hidden = lists.bench.hidden = bench === 0;
  $("more").hidden = players.length === 0;
  $("lineup-count").textContent = players.length
    ? `${starters} starter${starters === 1 ? "" : "s"} · ${bench} bench`
    : "No players yet";
}

/** Show one way of adding players: search, a Sleeper import or a pasted list. */
function setMethod(next: Method, focus = false): void {
  method = next;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#methods [data-method]")) {
    button.setAttribute("aria-pressed", String(button.dataset.method === next));
  }
  for (const name of ["search", "sleeper", "paste"] as const) $(`method-${name}`).hidden = name !== next;
  $("methods").hidden = roster.entries.length > 0 && next === "search";
  if (focus) $({ search: "search", sleeper: "sleeper-username", paste: "paste" }[next]).focus();
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
  if (added.length) {
    $<HTMLTextAreaElement>("paste").value = "";
    if (!pasteIssues.length) method = "search";
  }
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
  pasteIssues = [];
  const notes = [`Imported ${lineup.entries.length} players from ${league.name}.`];
  notes.push(lineup.scoringIsPreset
    ? `Scoring set to ${SCORING_LABEL[lineup.scoring]}; other custom league scoring isn’t applied.`
    : `This league gives ${league.pointsPerReception} per reception; showing the nearest preset, ${SCORING_LABEL[lineup.scoring]}.`);
  if (lineup.skipped) notes.push(`${lineup.skipped} player${lineup.skipped === 1 ? "" : "s"} at positions without projections ${lineup.skipped === 1 ? "was" : "were"} left out.`);
  $("sleeper-status").textContent = notes.join(" ");
  $("sleeper-leagues").replaceChildren();
  method = "search";
  commit({ ...roster, scoring: lineup.scoring, entries: lineup.entries });
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
  const known = EXAMPLE_LINEUP.filter(([id]) => id in data.directory);
  if (known.length >= EXAMPLE_SLOTS.length) return { ...roster, entries: known.map(([id, slot]) => ({ id, slot })) };
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
    const missing = player.proj == null;
    const row = el("li", undefined, "player" + (missing ? " no-proj" : ""));
    const portrait = el("span", undefined, "portrait");
    teamColors(portrait, player.team);
    portrait.append(el("span", jerseyText(player), "number"));
    const media = data.manifest.media;
    const isDefense = player.pos === "DST";
    const shown = isDefense
      ? media.logos && addImage(portrait, logoUrl(player.team), "headshot logo", () => portrait.classList.remove("has-photo", "has-logo"))
      : media.headshots && addImage(portrait, headshotUrl(player.id), "headshot", () => portrait.classList.remove("has-photo"));
    if (shown) portrait.classList.add("has-photo", ...(isDefense ? ["has-logo"] : []));
    const info = el("span", undefined, "player-info");
    const slot = player.slot === player.pos ? "" : ` · ${player.slot}`;
    const meta = el("span", `${player.team} · ${player.pos}${slot}`, "meta");
    if (missing) {
      const tag = el("span", undefined, "tag");
      tag.title = "Often injured, inactive or on IR. Not counted as zero.";
      tag.append(icon(ICONS.info), "No projection");
      meta.append(tag);
    }
    info.append(el("span", player.name, "player-name"), meta);
    row.append(portrait, info, el("span", points(player.proj), "value"));
    list.append(row);
  }
  return list;
}

function matchup(game: RankedGame, data: Bundle): HTMLElement {
  const heading = el("h4", undefined, "matchup");
  heading.setAttribute("aria-label", `${game.away} at ${game.home}`);
  const team = (code: string) => {
    const badge = el("span", undefined, "team");
    const mark = el("span", undefined, "team-mark");
    mark.setAttribute("aria-hidden", "true");
    teamColors(mark, code);
    badge.append(mark, code);
    if (data.manifest.media.logos) addImage(badge, logoUrl(code), "team-mark", () => badge.prepend(mark));
    if (badge.querySelector("img")) mark.remove();
    return badge;
  };
  heading.append(team(game.away), el("span", "at", "versus"), team(game.home));
  return heading;
}

function kickoffText(game: RankedGame): string {
  const time = new Date(game.kick).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const state = game.status === "STATUS_FINAL" ? "Final" : Date.parse(game.kick) < Date.now() ? "Kicked off" : "";
  return [time, game.network, state].filter(Boolean).join(" · ");
}

function gameCard(game: RankedGame, featured: boolean, data: Bundle): HTMLElement {
  const over = game.status === "STATUS_FINAL";
  const card = el("article", undefined, "game" + (over ? " over" : ""));
  const head = el("div", undefined, "game-head");
  const title = el("div");
  const heading = matchup(game, data);
  if (featured) heading.append(el("span", "Watch first", "stamp"));
  title.append(heading, el("div", kickoffText(game), "kick"));
  const count = game.starters.length;
  const projected = game.starters.filter((p) => p.proj != null).length;
  const label = projected === count ? `${count} starter${count === 1 ? "" : "s"}` : `${projected} of ${count} projected`;
  const total = el("div", undefined, "total");
  total.append(el("strong", projected ? points(game.starter_pts) : "—"), el("small", label));
  head.append(title, total);
  const tear = el("div", undefined, "tear");
  tear.setAttribute("aria-hidden", "true");
  card.append(head, tear, playerList(game.starters, data));
  if (game.bench.length) card.append(el("p", "Bench · breaks ties", "bench-label"), playerList(game.bench, data, true));
  return card;
}

/** A game with only bench players in it: one line, since it only breaks ties. */
function benchCard(game: RankedGame, data: Bundle): HTMLElement {
  const card = el("article", undefined, "game compact" + (game.status === "STATUS_FINAL" ? " over" : ""));
  const players = el("ul", undefined, "compact-players");
  for (const player of game.bench) {
    const item = el("li", `${jerseyText(player)} ${player.name}`);
    item.append(el("span", points(player.proj), "value"));
    players.append(item);
  }
  card.append(matchup(game, data), el("span", kickoffText(game), "kick"), el("span", "Bench only", "compact-label"), players);
  return card;
}

/** Day and start time of a kickoff window for the sideline, in the viewer's timezone. */
function railLabel(window: KickoffWindow): [string, string] {
  const start = new Date(window.id);
  const time = start.toLocaleTimeString([], { hour: "numeric", minute: start.getMinutes() ? "2-digit" : undefined });
  return [start.toLocaleDateString([], { weekday: "short" }), time];
}

/** Games in a window without any of the viewer's players, as dotted placeholders. */
function slate(games: RankedGame[], data: Bundle, label?: string): HTMLElement {
  const wrap = el("div", undefined, "slate-wrap");
  if (label) wrap.append(el("p", label, "slate-label"));
  const list = el("ul", undefined, "slate");
  for (const game of games) {
    const item = el("li");
    item.append(matchup(game, data), el("span", kickoffText(game), "kick"));
    list.append(item);
  }
  wrap.append(list);
  return wrap;
}

function windowRow(day: string, time: string): { row: HTMLElement; body: HTMLElement } {
  const row = el("section", undefined, "window");
  const rail = el("h3", undefined, "rail");
  rail.append(el("span", day, "day"), el("span", time, "time"));
  const body = el("div", undefined, "window-body");
  row.append(rail, body);
  return { row, body };
}

function renderResults(ranking: Ranking, data: Bundle): void {
  const results = $("results");
  results.replaceChildren();
  for (const window of ranking.windows) {
    const { row, body } = windowRow(...railLabel(window));
    const mine = window.games.filter((g) => g.starters.length || g.bench.length);
    if (!mine.length) body.append(slate(window.games, data, "None of your players"));
    mine.forEach((game, i) => body.append(game.starters.length ? gameCard(game, i === 0, data) : benchCard(game, data)));
    const unwatched = window.games.filter((g) => !mine.includes(g));
    if (mine.length && unwatched.length) body.append(slate(unwatched, data, "None of your players"));
    results.append(row);
  }
  if (ranking.idle.length) {
    const { row, body } = windowRow("This week", "Not playing");
    const card = el("article", undefined, "game idle");
    card.append(playerList(ranking.idle, data));
    body.append(card);
    results.append(row);
  }
}

/** Before any players are added: this week's real games, with a prompt to add players. */
function renderPreview(data: Bundle): void {
  const results = $("results");
  results.replaceChildren();
  rank([], data.schedule).windows.forEach((window, i) => {
    const { row, body } = windowRow(...railLabel(window));
    if (i === 0) {
      const guide = el("div", undefined, "guide");
      guide.append(el("strong", "Add players to see your projected points in every game."),
        el("p", "Each game totals what your lineup is projected to score in it, and the best one leads its time slot."));
      body.append(guide);
    }
    body.append(slate(window.games, data));
    results.append(row);
  });
}

function timeZoneName(): string {
  return new Intl.DateTimeFormat([], { timeZoneName: "short" }).formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value ?? "your timezone";
}

function renderStatus(data: Bundle): void {
  const { manifest } = data;
  const updated = age(manifest.projections.fetched_at ?? manifest.generated_at);
  const games = data.schedule.length;
  $("status").textContent = `${SCORING_LABEL[roster.scoring]} · ${games} game${games === 1 ? "" : "s"} · Times in ${timeZoneName()}`;
  const source = $("source");
  source.classList.toggle("stale", !manifest.demo && (!updated || updated.hours > STALE_AFTER_HOURS));
  source.textContent = manifest.demo
    ? "Example data, not real projections."
    : `${manifest.projections.attribution ?? "Projections"} · updated ${updated?.text ?? "at an unknown time"}`;
  $("field-title").textContent = `Week ${manifest.week} watch list`;
}

function note(title: string, lines: string[], options: { action?: HTMLButtonElement; warn?: boolean } = {}): HTMLElement {
  const box = el("div", undefined, "note" + (options.warn ? " warn" : ""));
  box.setAttribute("role", "status");
  const text = el("div");
  text.append(el("strong", title));
  if (lines.length) {
    const list = el("ul");
    for (const line of lines) list.append(el("li", line));
    text.append(list);
  }
  if (options.action) text.append(el("br"), options.action);
  box.append(icon(options.warn ? ICONS.alert : ICONS.info), text);
  return box;
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", label, "secondary");
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

/** Notes sit in the lineup panel. A missing projection is marked on its player instead. */
function renderNotices(ranking: Ranking, missing: number, data: Bundle): void {
  const box = $("issues");
  box.replaceChildren();
  if (viewingShared) {
    box.append(note("You’re viewing a shared lineup.", ["It isn’t saved on this device."],
      { action: actionButton("Keep this lineup", () => commit(roster)) }));
  } else if (needsReview(roster, weekKey(data.manifest.season, data.manifest.week))) {
    const flags = teamChanges(roster, data.directory).map((c) => `${c.name} moved from ${c.from} to ${c.to}.`);
    if (ranking.idle.length) flags.push(`Not playing this week: ${ranking.idle.map((p) => p.name).join(", ")}.`);
    box.append(note(`It’s Week ${data.manifest.week}. Still your lineup?`, flags,
      { action: actionButton("Looks right", () => commit(roster)) }));
  }

  const problems = pasteIssues.map((i) => `Line ${i.line}: “${i.text}” — ${i.message}`);
  if (missing) problems.push(`${missing} saved player${missing === 1 ? " is" : "s are"} no longer in the player list and ${missing === 1 ? "was" : "were"} left out.`);
  if (problems.length) box.append(note("Some players weren’t added.", problems, { warn: true }));
}

/** Nothing to rank: say so, and leave the saved lineup untouched for next season. */
function renderOffSeason(manifest: OffSeasonManifest): void {
  $("board-season").textContent = String(manifest.season);
  $("field-title").textContent = manifest.phase === "pre" ? "Almost kickoff" : "See you next season";
  $("status").textContent = manifest.phase === "pre"
    ? `The ${manifest.season} regular season hasn’t started. Matchups appear once Week 1 is scheduled.`
    : `The ${manifest.season} fantasy regular season is over.`;
  $("placeholder-title").textContent = manifest.phase === "pre" ? "Almost kickoff." : "See you next season.";
  $("placeholder-text").textContent = roster.entries.length
    ? "Your saved lineup is still here and will be ready when the games are."
    : "Come back when the regular season is under way.";
  $("placeholder").hidden = false;
  $("source").textContent = "";
  $("share").hidden = true;
  $("results").replaceChildren();
  $("issues").replaceChildren();
  $("controls").hidden = true;
  $("workspace").classList.remove("is-empty");
  $("workspace").classList.add("no-controls");
}

function render(): void {
  $("board-scoring").textContent = SCORING_BOARD[roster.scoring];
  for (const button of document.querySelectorAll<HTMLButtonElement>("#scoring [data-scoring]")) {
    button.setAttribute("aria-pressed", String(button.dataset.scoring === roster.scoring));
  }
  if (offSeason) return renderOffSeason(offSeason);
  if (!bundle) return;
  $("controls").hidden = false;
  $("workspace").classList.remove("no-controls");
  $("board-week").textContent = String(bundle.manifest.week).padStart(2, "0");
  $("board-season").textContent = String(bundle.manifest.season);
  const { players, missing } = resolveRoster(roster, bundle.directory);
  renderRoster(players);
  setMethod(method);
  renderSleeperSource();
  renderStatus(bundle);
  attachProjections(players, bundle.projections, roster.scoring);
  const ranking = rank(players, bundle.schedule);
  renderNotices(ranking, missing.length, bundle);
  const hasPlayers = players.length > 0;
  $("workspace").classList.toggle("is-empty", !hasPlayers);
  $("placeholder").hidden = true;
  $("share").hidden = !hasPlayers;
  if (hasPlayers) renderResults(ranking, bundle);
  else renderPreview(bundle);
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
  if (sleeperSource) $<HTMLInputElement>("sleeper-username").value = sleeperSource.username;
  wireSearch();
  wireSleeper();
  for (const button of document.querySelectorAll<HTMLButtonElement>("#scoring [data-scoring]")) {
    button.addEventListener("click", () => commit({ ...roster, scoring: button.dataset.scoring as Scoring }, !viewingShared));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-method]")) {
    button.addEventListener("click", () => setMethod(button.dataset.method as Method, button.closest("#more") !== null));
  }
  $("paste-add").addEventListener("click", importPaste);
  $("example").addEventListener("click", () => { if (bundle) { method = "search"; commit(exampleRoster(bundle)); } });
  $("clear").addEventListener("click", () => {
    pasteIssues = [];
    sleeperSource = null;
    saveSource(storage, null);
    $("sleeper-status").textContent = "";
    commit({ ...roster, entries: [] });
  });
  let shareNote: number | undefined;
  $("share").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#${encodeShare(roster)}`;
    const status = $("share-status");
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = "Link copied. Anyone with it can see this lineup.";
    } catch {
      history.replaceState(null, "", url);
      status.textContent = "The link is in your address bar. Anyone with it can see this lineup.";
    }
    window.clearTimeout(shareNote);
    shareNote = window.setTimeout(() => { status.textContent = ""; }, SHARE_NOTE_MS);
  });
  document.addEventListener("visibilitychange", () => void refreshIfNewer());
  window.addEventListener("hashchange", () => { if (openSharedLineup()) render(); });
  render();
  void load();
}

start();
