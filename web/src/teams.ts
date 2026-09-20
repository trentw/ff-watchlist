/** Primary team colors, used for the accent under a player card. */
export const TEAM_COLORS: Record<string, string> = {
  ARI: "#97233f", ATL: "#a71930", BAL: "#241773", BUF: "#00338d", CAR: "#0085ca", CHI: "#0b162a",
  CIN: "#fb4f14", CLE: "#311d00", DAL: "#003594", DEN: "#fb4f14", DET: "#0076b6", GB: "#203731",
  HOU: "#03202f", IND: "#002c5f", JAX: "#006778", KC: "#e31837", LV: "#000000", LAR: "#003594",
  LAC: "#0080c6", MIA: "#008e97", MIN: "#4f2683", NE: "#002244", NO: "#d3bc8d", NYG: "#0b2265",
  NYJ: "#125740", PHI: "#004c54", PIT: "#ffb612", SF: "#aa0000", SEA: "#002244", TB: "#d50a0a",
  TEN: "#4b92db", WAS: "#5a1414",
};

const IMAGE_HOST = "https://sleepercdn.com";

export function logoUrl(team: string): string | null {
  return team in TEAM_COLORS ? `${IMAGE_HOST}/images/team_logos/nfl/${team.toLowerCase()}.png` : null;
}

export function headshotUrl(playerId: string): string | null {
  return /^\d+$/.test(playerId) ? `${IMAGE_HOST}/content/nfl/players/thumb/${playerId}.jpg` : null;
}
