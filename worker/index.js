import { randomToken, sha256, signHandle, verifyHandle } from "./crypto.js";
import { YahooSession } from "./session.js";
import { YahooError } from "./yahoo-api.js";

export { YahooSession };

const COOKIE = "__Host-ffw-yahoo";
const MAX_AGE = 30 * 86400;

function response(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", ...extra,
  } });
}

function cookie(name, value, age) {
  return `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
}

function cookieValue(request, name) {
  return request.headers.get("Cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

async function session(request, env) {
  const id = await verifyHandle(cookieValue(request, COOKIE), env.YAHOO_COOKIE_KEY);
  if (!id) return null;
  const name = await sha256(id);
  return { id, stub: env.YAHOO_SESSIONS.getByName(name) };
}

function enabled(env) {
  return env.YAHOO_ENABLED === "true" && !!env.YAHOO_CLIENT_ID && !!env.YAHOO_TOKEN_KEY && !!env.YAHOO_COOKIE_KEY;
}

function checkPost(request, env) {
  if (request.headers.get("Origin") !== env.APP_ORIGIN) throw new YahooError("bad_origin", 403);
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") throw new YahooError("bad_origin", 403);
}

async function currentWeek(env) {
  const result = await env.ASSETS.fetch(new Request(`${env.APP_ORIGIN}/data/manifest.json`, { headers: { Accept: "application/json" } }));
  if (!result.ok) throw new YahooError("bundle_unavailable", 503);
  const manifest = await result.json();
  if (manifest?.schema !== 1 || manifest.week == null || manifest.demo) throw new YahooError("week_unavailable", 409);
  return { season: manifest.season, week: manifest.week };
}

async function callback(request, env, url) {
  const redirect = (outcome, setCookie) => new Response(null, { status: 303, headers: {
    Location: `${env.APP_ORIGIN}/?yahoo=${outcome}`, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    ...(setCookie ? { "Set-Cookie": setCookie } : {}),
  } });
  const current = await session(request, env);
  const state = url.searchParams.getAll("state");
  const codes = url.searchParams.getAll("code");
  if (!current || state.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(state[0])) return redirect("error");
  if (url.searchParams.has("error")) {
    try { await current.stub.deny(await sha256(state[0])); }
    catch { return redirect("error"); }
    return redirect("denied");
  }
  if (codes.length !== 1 || !codes[0] || codes[0].length > 4096) return redirect("error");
  try {
    await current.stub.finish(await sha256(state[0]), codes[0], current.id);
    return redirect("connected", cookie(COOKIE, await signHandle(current.id, env.YAHOO_COOKIE_KEY), MAX_AGE));
  } catch { return redirect("error"); }
}

async function route(request, env) {
  const url = new URL(request.url);
  if (url.origin !== env.APP_ORIGIN) return response({ error: { code: "bad_origin" } }, 403);
  if (url.pathname === "/api/yahoo/session" && request.method === "GET") {
    if (!enabled(env)) return response({ enabled: false, connected: false });
    const current = await session(request, env);
    return response({ enabled: true, ...(current ? await current.stub.status() : { connected: false }) });
  }
  if (!enabled(env)) return response({ error: { code: "yahoo_disabled" } }, 503);
  if (url.pathname === "/api/yahoo/callback" && request.method === "GET") return callback(request, env, url);
  if (request.method === "POST") checkPost(request, env);

  if (url.pathname === "/api/yahoo/connect" && request.method === "POST") {
    const old = await session(request, env);
    if (old) await old.stub.disconnect();
    const id = randomToken();
    const state = randomToken();
    const verifier = randomToken();
    const challenge = await sha256(verifier);
    const stub = env.YAHOO_SESSIONS.getByName(await sha256(id));
    await stub.begin(await sha256(state), verifier);
    const authorize = new URL("https://api.login.yahoo.com/oauth2/request_auth");
    authorize.search = new URLSearchParams({ client_id: env.YAHOO_CLIENT_ID, redirect_uri: env.YAHOO_REDIRECT_URI,
      response_type: "code", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    return response({ authorizeUrl: authorize.toString() }, 200, { "Set-Cookie": cookie(COOKIE, await signHandle(id, env.YAHOO_COOKIE_KEY), 600) });
  }

  const current = await session(request, env);
  if (url.pathname === "/api/yahoo/disconnect" && request.method === "POST") {
    if (current) await current.stub.disconnect();
    return response({ connected: false }, 200, { "Set-Cookie": cookie(COOKIE, "", 0) });
  }
  if (!current || !(await current.stub.status()).connected) return response({ error: { code: "reconnect_required" } }, 401);

  if (url.pathname === "/api/yahoo/teams" && request.method === "GET") {
    const week = await currentWeek(env);
    return response({ season: week.season, teams: await current.stub.teams(week.season, current.id) });
  }
  if (url.pathname === "/api/yahoo/import" && request.method === "POST") {
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") throw new YahooError("bad_request", 400);
    if (Number(request.headers.get("Content-Length")) > 512) throw new YahooError("bad_request", 400);
    const raw = await request.text();
    if (raw.length > 512) throw new YahooError("bad_request", 400);
    let body;
    try { body = JSON.parse(raw); } catch { throw new YahooError("bad_request", 400); }
    const displayed = await currentWeek(env);
    if (body?.season !== displayed.season || body?.week !== displayed.week || typeof body?.teamKey !== "string") throw new YahooError("week_changed", 409);
    const imported = await current.stub.importRoster(body.teamKey, body.season, body.week, current.id);
    return imported.ok ? response(imported.value) : response({ error: { code: imported.code } }, 502);
  }
  return response({ error: { code: "not_found" } }, 404);
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (error) {
      // Durable Object RPC serializes errors, so the YahooError subclass may be lost.
      // Only pass through known, data-free error codes across that boundary.
      const remoteCode = error instanceof Error && /^(?:bad_request|reconnect_required|authorization_failed|invalid_state|yahoo_invalid_response|yahoo_unauthorized|yahoo_forbidden|yahoo_rate_limited|yahoo_unavailable|yahoo_response_too_large|season_unavailable|too_many_teams|too_many_leagues|not_your_team|roster_unavailable|roster_empty|roster_too_large|week_changed)$/.test(error.message)
        ? error.message : null;
      const code = error instanceof YahooError ? error.code : remoteCode ?? "temporarily_unavailable";
      const status = error instanceof YahooError ? error.status : 503;
      return response({ error: { code } }, status);
    }
  },
};
