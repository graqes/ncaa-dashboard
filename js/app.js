// Dashboard behaviour: the ranked overview and the team detail view.
//
// Both views live in one page. Clicking a team swaps to the team view and sets
// a hash like #team/2509/2019, so the browser Back button and a pasted link
// both work.

// ---------------------------------------------------------------- overview

const overview = {
  seasons: [],
  season: null,
  query: '',
  metric: 'avg_points',
  chart: null,
};

const METRIC_LABELS = {
  avg_points: 'Points per game',
  avg_assists: 'Assists per game',
  avg_fouls: 'Fouls per game',
  avg_steals: 'Steals per game',
  avg_blocks: 'Blocks per game',
  avg_three_pt_attempts: '3-point attempts per game',
  avg_offensive_rebounds: 'Offensive rebounds per game',
  avg_defensive_rebounds: 'Defensive rebounds per game',
};

const ui = {
  title: document.getElementById('page-title'),
  subtitle: document.getElementById('page-subtitle'),
  viewOverview: document.getElementById('view-overview'),
  viewTeam: document.getElementById('view-team'),
  // overview
  seasonLabel: document.getElementById('season-label'),
  seasonSelect: document.getElementById('season-select'),
  search: document.getElementById('search'),
  list: document.getElementById('team-list'),
  listStatus: document.getElementById('list-status'),
  timeline: document.getElementById('season-timeline'),
  metric: document.getElementById('trend-metric'),
  // team
  teamSeasonSelect: document.getElementById('team-season-select'),
  toggles: document.getElementById('stat-toggles'),
  scatterStatus: document.getElementById('scatter-status'),
  backLink: document.getElementById('back-link'),
};

async function initOverview() {
  try {
    overview.seasons = await DataSource.seasons();
  } catch (err) {
    ui.listStatus.textContent = `Could not load data: ${err.message}`;
    return;
  }
  if (!overview.seasons.length) {
    ui.listStatus.textContent = 'No seasons returned.';
    return;
  }

  overview.season = overview.seasons[overview.seasons.length - 1].season;

  ui.seasonSelect.innerHTML = overview.seasons.slice().reverse()
    .map(s => `<option value="${s.season}">${fmt.seasonLabel(s.season)}</option>`).join('');
  ui.seasonSelect.value = overview.season;

  renderTimeline();
  renderTrendChart();
  await loadTeams();

  ui.seasonSelect.addEventListener('change', e => selectSeason(Number(e.target.value)));
  ui.metric.addEventListener('change', e => {
    overview.metric = e.target.value;
    renderTimeline();
    renderTrendChart();
  });

  let debounce;
  ui.search.addEventListener('input', e => {
    overview.query = e.target.value;
    clearTimeout(debounce);
    debounce = setTimeout(loadTeams, 180);
  });
}

function selectSeason(season) {
  overview.season = season;
  ui.seasonSelect.value = season;
  renderTimeline();
  renderTrendChart();
  loadTeams();
}

// The timeline doubles as the season filter: each entry is a button.
function renderTimeline() {
  ui.timeline.innerHTML = overview.seasons.slice().reverse().map(s => `
    <button type="button" class="season-button" role="listitem"
            data-season="${s.season}"
            aria-current="${s.season === overview.season}">
      ${fmt.seasonLabel(s.season)}
      <span class="season-meta">${fmt.num(s[overview.metric])}</span>
    </button>
  `).join('');

  ui.timeline.querySelectorAll('.season-button').forEach(btn => {
    btn.addEventListener('click', () => selectSeason(Number(btn.dataset.season)));
  });
}

function renderTrendChart() {
  const labels = overview.seasons.map(s => fmt.seasonLabel(s.season));
  const values = overview.seasons.map(s => s[overview.metric]);
  // Highlight the selected season so the chart and the list agree.
  const pointColors = overview.seasons.map(s =>
    s.season === overview.season ? '#b45309' : '#2f5fd0');
  const pointSizes = overview.seasons.map(s => s.season === overview.season ? 6 : 3);

  if (overview.chart) overview.chart.destroy();

  overview.chart = new Chart(document.getElementById('trend-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: METRIC_LABELS[overview.metric],
        data: values,
        borderColor: '#2f5fd0',
        backgroundColor: 'rgba(47, 95, 208, .12)',
        pointBackgroundColor: pointColors,
        pointRadius: pointSizes,
        fill: true,
        tension: .25,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `League average: ${METRIC_LABELS[overview.metric].toLowerCase()}`,
          align: 'start',
          font: { size: 13 },
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y} ${METRIC_LABELS[overview.metric].toLowerCase()}`,
          },
        },
      },
      onClick: (evt, points) => {
        if (points.length) selectSeason(overview.seasons[points[0].index].season);
      },
      scales: {
        y: { title: { display: true, text: METRIC_LABELS[overview.metric] } },
        x: { ticks: { maxRotation: 0, autoSkipPadding: 12 } },
      },
    },
  });
}

async function loadTeams() {
  ui.seasonLabel.textContent = fmt.seasonLabel(overview.season);
  ui.listStatus.textContent = 'Loading teams...';
  ui.list.innerHTML = '';

  let teams;
  try {
    teams = await DataSource.standings(overview.season, overview.query);
  } catch (err) {
    ui.listStatus.textContent = `Could not load teams: ${err.message}`;
    return;
  }

  if (!teams.length) {
    ui.listStatus.textContent = overview.query
      ? `No teams match "${overview.query}" in ${fmt.seasonLabel(overview.season)}.`
      : 'No teams found for this season.';
    return;
  }

  ui.listStatus.textContent = `${teams.length} teams, ranked by win rate.`;

  ui.list.innerHTML = teams.map((t, i) => `
    <li>
      <button type="button" class="team-row"
              data-team="${t.team_id}" data-season="${overview.season}">
        <span class="rank">${i + 1}</span>
        <span class="team-name">
          <span class="swatch" style="background:${fmt.teamColor(t.team_color)}"></span>
          ${t.team_display_name}
        </span>
        <span class="record">
          <span class="win-rate">${fmt.pct(t.win_rate)}</span><br>
          <span class="wl">${t.wins}-${t.losses}</span>
        </span>
      </button>
    </li>
  `).join('');

  ui.list.querySelectorAll('.team-row').forEach(row => {
    row.addEventListener('click', () => {
      window.location.hash = `team/${row.dataset.team}/${row.dataset.season}`;
    });
  });
}

// ------------------------------------------------------------- team view

const team = {
  teamId: null,
  season: null,
  stat: 'assists',
  seasons: [],
  games: [],
  scatter: null,
  history: null,
  wired: false,
};

const STATS = [
  { key: 'assists', label: 'Assists' },
  { key: 'total_rebounds', label: 'Rebounds' },
  { key: 'steals', label: 'Steals' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'fouls', label: 'Fouls' },
  { key: 'field_goal_pct', label: 'FG%' },
  { key: 'three_point_field_goals_attempted', label: '3PT attempts' },
];

const WIN_COLOR = '#1f7a5a';
const LOSS_COLOR = '#b4451f';

async function openTeam(teamId, season) {
  team.teamId = Number(teamId);
  team.season = Number(season) || null;

  try {
    team.seasons = await DataSource.teamSeasons(team.teamId);
  } catch (err) {
    ui.scatterStatus.textContent = `Could not load this team: ${err.message}`;
    return;
  }

  if (!team.seasons.length) {
    ui.title.textContent = 'Team not found';
    ui.scatterStatus.textContent = 'No seasons on record for this team.';
    return;
  }

  const latest = team.seasons[team.seasons.length - 1];
  if (!team.season || !team.seasons.some(s => s.season === team.season)) {
    team.season = latest.season;
  }

  ui.title.textContent = latest.team_display_name;

  ui.teamSeasonSelect.innerHTML = team.seasons.slice().reverse()
    .map(s => `<option value="${s.season}">${fmt.seasonLabel(s.season)}</option>`).join('');
  ui.teamSeasonSelect.value = team.season;

  ui.toggles.innerHTML = STATS.map(s => `
    <button type="button" class="toggle" data-stat="${s.key}"
            aria-pressed="${s.key === team.stat}">${s.label}</button>
  `).join('');

  ui.toggles.querySelectorAll('.toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      team.stat = btn.dataset.stat;
      ui.toggles.querySelectorAll('.toggle').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.stat === team.stat)));
      renderScatter();
    });
  });

  if (!team.wired) {
    ui.teamSeasonSelect.addEventListener('change', e => {
      team.season = Number(e.target.value);
      window.location.hash = `team/${team.teamId}/${team.season}`;
      loadGames();
    });
    team.wired = true;
  }

  renderHistory();
  await loadGames();
}

function currentSeasonRow() {
  return team.seasons.find(s => s.season === team.season);
}

async function loadGames() {
  ui.scatterStatus.textContent = 'Loading games...';
  try {
    team.games = await DataSource.teamGames(team.teamId, team.season);
  } catch (err) {
    ui.scatterStatus.textContent = `Could not load games: ${err.message}`;
    return;
  }

  const row = currentSeasonRow();
  ui.subtitle.textContent = row
    ? `${fmt.seasonLabel(row.season)} season - ${row.wins}-${row.losses} `
      + `(${fmt.pct(row.win_rate)} win rate), ${fmt.num(row.avg_points)} points per game`
    : `${fmt.seasonLabel(team.season)} season`;

  renderHistory();
  renderScatter();
}

function renderScatter() {
  const stat = STATS.find(s => s.key === team.stat);

  if (!team.games.length) {
    if (team.scatter) { team.scatter.destroy(); team.scatter = null; }
    ui.scatterStatus.textContent = 'No games found for this team and season.';
    return;
  }

  const points = team.games
    .filter(g => g[team.stat] !== null && g[team.stat] !== undefined)
    .map(g => ({ x: g[team.stat], y: g.team_score, won: g.team_winner === 1, meta: g }));

  const wins = points.filter(p => p.won);
  const losses = points.filter(p => !p.won);

  if (team.scatter) team.scatter.destroy();

  team.scatter = new Chart(document.getElementById('scatter-chart'), {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: `Wins (${wins.length})`,
          data: wins,
          backgroundColor: WIN_COLOR,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
        {
          label: `Losses (${losses.length})`,
          data: losses,
          backgroundColor: LOSS_COLOR,
          pointStyle: 'triangle',   // shape as well as colour, for colour-blind readers
          pointRadius: 6,
          pointHoverRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true } },
        title: {
          display: true,
          text: `${stat.label} vs points scored, ${fmt.seasonLabel(team.season)}`,
          align: 'start',
          font: { size: 13 },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const g = ctx.raw.meta;
              const result = g.team_winner === 1 ? 'W' : 'L';
              return [
                `${result} ${g.team_score}-${g.opponent_score} vs ${g.opponent}`,
                `${g.game_date} (${g.team_home_away})`,
                `${stat.label}: ${ctx.raw.x}`,
              ];
            },
          },
        },
      },
      scales: {
        x: { title: { display: true, text: stat.label } },
        y: { title: { display: true, text: 'Points scored' } },
      },
    },
  });

  const avg = arr => arr.length
    ? (arr.reduce((sum, p) => sum + p.x, 0) / arr.length).toFixed(1) : '--';
  ui.scatterStatus.textContent =
    `${stat.label} in wins: ${avg(wins)} | in losses: ${avg(losses)}`;
}

function renderHistory() {
  if (team.history) team.history.destroy();

  team.history = new Chart(document.getElementById('history-chart'), {
    type: 'bar',
    data: {
      labels: team.seasons.map(s => fmt.seasonLabel(s.season)),
      datasets: [{
        label: 'Win rate',
        data: team.seasons.map(s => s.win_rate),
        backgroundColor: team.seasons.map(s =>
          s.season === team.season ? '#b45309' : '#93a4c8'),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const s = team.seasons[ctx.dataIndex];
              return `${s.wins}-${s.losses} (${fmt.pct(s.win_rate)})`;
            },
          },
        },
      },
      onClick: (evt, bars) => {
        if (!bars.length) return;
        team.season = team.seasons[bars[0].index].season;
        ui.teamSeasonSelect.value = team.season;
        window.location.hash = `team/${team.teamId}/${team.season}`;
        loadGames();
      },
      scales: {
        y: {
          min: 0, max: 1,
          title: { display: true, text: 'Win rate' },
          ticks: { callback: v => `${Math.round(v * 100)}%` },
        },
      },
    },
  });
}

// ---------------------------------------------------------------- routing

function showOverview() {
  ui.viewTeam.hidden = true;
  ui.viewOverview.hidden = false;
  ui.title.textContent = 'NCAA Women’s Basketball Statistics';
  ui.subtitle.textContent = 'Team rankings and league trends by season (2014-2026)';
}

function showTeam(teamId, season) {
  ui.viewOverview.hidden = true;
  ui.viewTeam.hidden = false;
  openTeam(teamId, season);
}

function route() {
  const match = window.location.hash.match(/^#team\/(\d+)(?:\/(\d+))?/);
  if (match) {
    showTeam(match[1], match[2]);
  } else {
    showOverview();
  }
}

ui.backLink.addEventListener('click', e => {
  e.preventDefault();
  window.location.hash = '';
});

window.addEventListener('hashchange', route);

initOverview().then(route);
