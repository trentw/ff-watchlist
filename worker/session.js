import { DurableObject } from "cloudflare:workers";
import { open, seal } from "./crypto.js";
import { fantasyGet, readGame, readLeagueName, readReception, readRoster, readTeams, validLeagueKey, validTeamKey, YahooError } from "./yahoo-api.js";

const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const CONNECTION_MS = 30 * 86400000;
const FLOW_MS = 10 * 60000;

async function tokenRequest(env, fields) {
  const response = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: env.YAHOO_CLIENT_ID, redirect_uri: env.YAHOO_REDIRECT_URI, ...fields }),
    signal: AbortSignal.timeout(10000),
  });
  const length = Number(response.headers.get("content-length"));
  if (length > 65536) throw new YahooError("yahoo_invalid_response");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 65536) throw new YahooError("yahoo_invalid_response");
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new YahooError("yahoo_invalid_response"); }
  if (!response.ok) throw new YahooError(fields.grant_type === "refresh_token" ? "reconnect_required" : "authorization_failed", 401);
  if (typeof body.access_token !== "string" || !body.access_token || !Number.isFinite(Number(body.expires_in))) throw new YahooError("yahoo_invalid_response");
  return body;
}

export class YahooSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.refreshing = null;
    this.generation = 0;
  }

  async begin(stateHash, verifier) {
    this.ctx.storage.kv.put("flow", { stateHash, verifier, expiresAt: Date.now() + FLOW_MS });
    await this.ctx.storage.setAlarm(Date.now() + FLOW_MS);
  }

  async finish(stateHash, code, sessionId) {
    const flow = this.ctx.storage.kv.get("flow");
    if (!flow || flow.expiresAt < Date.now() || flow.stateHash !== stateHash) throw new YahooError("invalid_state", 400);
    this.ctx.storage.kv.delete("flow");
    const token = await tokenRequest(this.env, { grant_type: "authorization_code", code, code_verifier: flow.verifier });
    if (typeof token.refresh_token !== "string" || !token.refresh_token) throw new YahooError("yahoo_invalid_response");
    this.generation++;
    this.ctx.storage.kv.put("connection", {
      expiresAt: Date.now() + CONNECTION_MS,
      sealed: await seal({ access: token.access_token, refresh: token.refresh_token, accessExpiresAt: Date.now() + Number(token.expires_in) * 1000 }, this.env.YAHOO_TOKEN_KEY, sessionId),
    });
    await this.ctx.storage.setAlarm(Date.now() + CONNECTION_MS);
  }

  deny(stateHash) {
    const flow = this.ctx.storage.kv.get("flow");
    if (!flow || flow.expiresAt < Date.now() || flow.stateHash !== stateHash) throw new YahooError("invalid_state", 400);
    this.ctx.storage.kv.delete("flow");
  }

  status() {
    const connection = this.ctx.storage.kv.get("connection");
    return connection?.expiresAt > Date.now() ? { connected: true, expiresAt: new Date(connection.expiresAt).toISOString() } : { connected: false };
  }

  async disconnect() {
    this.generation++;
    this.refreshing = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const connection = this.ctx.storage.kv.get("connection");
    const flow = this.ctx.storage.kv.get("flow");
    if (connection?.expiresAt > Date.now() || flow?.expiresAt > Date.now()) {
      await this.ctx.storage.setAlarm(Math.min(...[connection?.expiresAt, flow?.expiresAt].filter((value) => value > Date.now())));
      return;
    }
    await this.ctx.storage.deleteAll();
  }

  async refresh(sessionId, force = false) {
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = (async () => {
      const connection = this.ctx.storage.kv.get("connection");
      if (!connection || connection.expiresAt <= Date.now()) throw new YahooError("reconnect_required", 401);
      const old = await open(connection.sealed, this.env.YAHOO_TOKEN_KEY, sessionId);
      if (!force && old.accessExpiresAt > Date.now() + 60000) return old.access;
      const renewed = await tokenRequest(this.env, { grant_type: "refresh_token", refresh_token: old.refresh });
      if (this.generation !== generation || this.ctx.storage.kv.get("connection")?.expiresAt !== connection.expiresAt) throw new YahooError("reconnect_required", 401);
      const next = {
        access: renewed.access_token,
        refresh: typeof renewed.refresh_token === "string" && renewed.refresh_token ? renewed.refresh_token : old.refresh,
        accessExpiresAt: Date.now() + Number(renewed.expires_in) * 1000,
      };
      this.ctx.storage.kv.put("connection", { ...connection, sealed: await seal(next, this.env.YAHOO_TOKEN_KEY, sessionId) });
      return next.access;
    })();
    try { return await this.refreshing; }
    finally { this.refreshing = null; }
  }

  async getAccess(sessionId) {
    const connection = this.ctx.storage.kv.get("connection");
    if (!connection || connection.expiresAt <= Date.now()) throw new YahooError("reconnect_required", 401);
    const token = await open(connection.sealed, this.env.YAHOO_TOKEN_KEY, sessionId);
    return token.accessExpiresAt > Date.now() + 60000 ? token.access : this.refresh(sessionId);
  }

  async read(sessionId, path) {
    let token = await this.getAccess(sessionId);
    try { return await fantasyGet(token, path); }
    catch (error) {
      if (!(error instanceof YahooError) || error.code !== "yahoo_unauthorized") throw error;
      token = await this.refresh(sessionId, true);
      return fantasyGet(token, path);
    }
  }

  async teams(season, sessionId) {
    const games = await this.read(sessionId, `/games;game_codes=nfl;seasons=${season}`);
    const gameKey = readGame(games, season);
    const users = await this.read(sessionId, `/users;use_login=1/games;game_keys=${gameKey}/teams`);
    const teams = readTeams(users, gameKey);
    if (teams.length > 30) throw new YahooError("too_many_teams", 409);
    const leagues = [...new Set(teams.map((team) => team.leagueKey))];
    if (leagues.length > 15) throw new YahooError("too_many_leagues", 409);
    const labels = new Map();
    for (const key of leagues) {
      if (!validLeagueKey(key)) throw new YahooError("yahoo_invalid_response");
      const league = await this.read(sessionId, `/league/${key}`);
      labels.set(key, readLeagueName(league, key));
    }
    return teams.map((team) => ({ ...team, leagueName: labels.get(team.leagueKey) }));
  }

  async importRoster(teamKey, season, week, sessionId) {
    let phase = "team_lookup";
    try {
      if (!validTeamKey(teamKey)) throw new YahooError("bad_request", 400);
      const owned = (await this.teams(season, sessionId)).find((team) => team.key === teamKey);
      if (!owned) throw new YahooError("not_your_team", 403);
      phase = "roster_fetch";
      const roster = await this.read(sessionId, `/team/${teamKey}/roster;week=${week}`);
      phase = "settings_fetch";
      const settings = await this.read(sessionId, `/league/${owned.leagueKey}/settings`);
      phase = "roster_parse";
      const players = readRoster(roster, teamKey, week);
      phase = "settings_parse";
      const pointsPerReception = readReception(settings);
      return { ok: true, value: { season, week, team: owned, fetchedAt: new Date().toISOString(), players, pointsPerReception } };
    } catch (error) {
      // RPC does not preserve custom Error subclasses. Return only a fixed error
      // code; never expose a provider response, token, or roster in diagnostics.
      return { ok: false, code: error instanceof YahooError ? error.code : `${phase}_failed` };
    }
  }
}
