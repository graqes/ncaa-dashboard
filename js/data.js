// Data layer.
//
// First choice:  api/data.php -> MySQL database baird32 (when hosted with PHP)
// Otherwise:     data/sample.js, built from the same SQL import files
//
// data/sample.js stores rows as compact arrays to keep the file small; the
// expand functions below turn them back into records with named fields, so the
// rest of the code sees one shape no matter which source answered.

function sampleData() {
  if (!window.SAMPLE_DATA) throw new Error('data file not loaded');
  return window.SAMPLE_DATA;
}

function teamInfo(teamId) {
  const t = sampleData().teams[String(teamId)];
  return t ? { abbreviation: t[0], name: t[1], color: t[2] } : null;
}

// [season, team_id, games, wins, pts, ast, fouls, stl, blk, reb]
function expandStanding(row) {
  const [season, teamId, games, wins, pts, ast, fouls, stl, blk, reb] = row;
  const info = teamInfo(teamId) || { abbreviation: '', name: `Team ${teamId}`, color: '' };
  return {
    season,
    team_id: teamId,
    team_abbreviation: info.abbreviation,
    team_display_name: info.name,
    team_color: info.color,
    games_played: games,
    wins,
    losses: games - wins,
    win_rate: Math.round((wins / games) * 1000) / 1000,
    avg_points: pts,
    avg_assists: ast,
    avg_fouls: fouls,
    avg_steals: stl,
    avg_blocks: blk,
    avg_total_rebounds: reb,
  };
}

// [date MM-DD, home, score, won, opp score, opp id, ast, fouls, stl, blk, reb, fg%, 3pa]
function expandGame(row, season) {
  const [date, home, score, won, oppScore, oppId, ast, fouls, stl, blk, reb, fgPct, tpa] = row;
  const month = Number(date.slice(0, 2));
  // A season labelled 2026 runs from November 2025 through April 2026.
  const year = month >= 8 ? season - 1 : season;
  const opp = teamInfo(oppId);
  return {
    game_date: `${year}-${date}`,
    team_home_away: home ? 'home' : 'away',
    team_score: score,
    team_winner: won,
    opponent_score: oppScore,
    opponent: opp ? opp.name : `Team ${oppId}`,
    assists: ast,
    fouls,
    steals: stl,
    blocks: blk,
    total_rebounds: reb,
    field_goal_pct: fgPct,
    three_point_field_goals_attempted: tpa,
  };
}

const DataSource = {
  async _api(type, params = {}) {
    const url = new URL('api/data.php', window.location.href);
    url.searchParams.set('type', type);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    const res = await fetch(url);
    const json = await res.json();
    if (json && json.error) throw new Error(json.error);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return json;
  },

  async seasons() {
    try {
      return await this._api('seasons');
    } catch (err) {
      return sampleData().seasons;
    }
  },

  async standings(season, query = '') {
    try {
      return await this._api('standings', { season, q: query });
    } catch (err) {
      const needle = query.trim().toLowerCase();
      return sampleData().standings
        .filter(r => r[0] === Number(season))
        .map(expandStanding)
        .filter(r => !needle
          || r.team_display_name.toLowerCase().includes(needle)
          || r.team_abbreviation.toLowerCase().includes(needle))
        .sort((a, b) => b.win_rate - a.win_rate || b.avg_points - a.avg_points);
    }
  },

  async teamSeasons(teamId) {
    try {
      return await this._api('team_seasons', { team_id: teamId });
    } catch (err) {
      return sampleData().standings
        .filter(r => r[1] === Number(teamId))
        .map(expandStanding)
        .sort((a, b) => a.season - b.season);
    }
  },

  async teamGames(teamId, season) {
    try {
      return await this._api('games', { team_id: teamId, season });
    } catch (err) {
      const rows = sampleData().games[`${teamId}:${season}`] || [];
      return rows.map(r => expandGame(r, Number(season)));
    }
  },
};

// Shared formatting helpers.
const fmt = {
  pct: v => (v === null || v === undefined) ? '--' : `${(v * 100).toFixed(1)}%`,
  num: (v, d = 1) => (v === null || v === undefined) ? '--' : Number(v).toFixed(d),
  // Season 2026 covers games played from Nov 2025 through Apr 2026.
  seasonLabel: s => `${s - 1}-${String(s).slice(2)}`,
  teamColor: hex => (hex && /^[0-9a-f]{6}$/i.test(hex)) ? `#${hex}` : '#6b7680',
};
