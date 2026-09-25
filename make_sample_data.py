"""
Build data/sample.js - the data the dashboard uses when the live MySQL
connection is not available (for example, opened straight from the folder).

Reads the same SQL import files that were loaded into the database, so the
offline copy and the live site are built from one source. Covers every team
and every season from 2014 on.

Rows are stored as compact arrays rather than objects; js/data.js expands them
back into records. Written as a .js file because browsers refuse to fetch() a
local .json when a page is opened from a folder.

Usage:
  python3 make_sample_data.py ~/Desktop/ncaa_mysql
"""

import gzip
import json
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

FIRST_SEASON = 2014
MIN_GAMES = 15

TEAM_COLS = ["team_id", "team_abbreviation", "team_display_name",
             "team_color", "team_alternate_color", "team_logo"]

GAME_COLS = ["game_id", "season", "season_type", "season_type_label", "game_date",
             "team_id", "team_home_away", "team_score", "team_winner",
             "assists", "blocks", "steals", "fouls", "flagrant_fouls",
             "offensive_rebounds", "defensive_rebounds", "total_rebounds",
             "field_goals_made", "field_goals_attempted", "field_goal_pct",
             "three_point_field_goals_made", "three_point_field_goals_attempted",
             "three_point_field_goal_pct",
             "free_throws_made", "free_throws_attempted", "free_throw_pct",
             "largest_lead"]


def parse_tuple(text):
    """Split one SQL VALUES tuple into Python values."""
    out, buf, in_str, i = [], [], False, 0
    while i < len(text):
        c = text[i]
        if in_str:
            if c == "'":
                if i + 1 < len(text) and text[i + 1] == "'":   # escaped quote
                    buf.append("'")
                    i += 2
                    continue
                in_str = False
            elif c == "\\" and i + 1 < len(text):
                buf.append(text[i + 1])
                i += 2
                continue
            else:
                buf.append(c)
        elif c == "'":
            in_str = True
        elif c == ",":
            out.append("".join(buf).strip())
            buf = []
        else:
            buf.append(c)
        i += 1
    out.append("".join(buf).strip())
    return [None if v == "NULL" else v for v in out]


def read_inserts(path, columns):
    """Yield one dict per row from a file of INSERT ... VALUES statements."""
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        text = f.read()
    for tup in re.findall(r"\(([^()]*)\)", text):
        if "`" in tup:          # the column list of an INSERT, not a data row
            continue
        values = parse_tuple(tup)
        if len(values) == len(columns):
            yield dict(zip(columns, values))


def num(v):
    if v is None or v == "":
        return None
    try:
        return int(v)
    except ValueError:
        return float(v)


def avg(values):
    vals = [v for v in values if v is not None]
    return round(statistics.fmean(vals), 2) if vals else None


def main():
    sql_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop/ncaa_mysql"
    out_dir = Path(__file__).parent / "data"
    out_dir.mkdir(exist_ok=True)

    team_rows = list(read_inserts(sql_dir / "02_team_data.sql", TEAM_COLS))
    teams = {int(t["team_id"]): [t["team_abbreviation"], t["team_display_name"],
                                 t["team_color"] or ""] for t in team_rows}
    print(f"Read {len(teams)} teams")

    rows = []
    for part in sorted(sql_dir.glob("03_game_data_part*.sql.gz")):
        part_rows = [r for r in read_inserts(part, GAME_COLS)
                     if int(r["season"]) >= FIRST_SEASON]
        rows.extend(part_rows)
        print(f"Read {len(part_rows):,} rows from {part.name}")

    # ---- league averages per season
    by_season = defaultdict(list)
    for r in rows:
        by_season[int(r["season"])].append(r)

    seasons = [{
        "season": season,
        "games": len({g["game_id"] for g in games}),
        "avg_points": avg([num(g["team_score"]) for g in games]),
        "avg_assists": avg([num(g["assists"]) for g in games]),
        "avg_fouls": avg([num(g["fouls"]) for g in games]),
        "avg_steals": avg([num(g["steals"]) for g in games]),
        "avg_blocks": avg([num(g["blocks"]) for g in games]),
        "avg_three_pt_attempts": avg([num(g["three_point_field_goals_attempted"]) for g in games]),
        "avg_offensive_rebounds": avg([num(g["offensive_rebounds"]) for g in games]),
        "avg_defensive_rebounds": avg([num(g["defensive_rebounds"]) for g in games]),
    } for season, games in sorted(by_season.items())]

    # ---- standings: [season, team_id, games, wins, pts, ast, fouls, stl, blk, reb]
    by_team_season = defaultdict(list)
    for r in rows:
        by_team_season[(int(r["season"]), int(r["team_id"]))].append(r)

    standings = []
    for (season, team_id), games in sorted(by_team_season.items()):
        if len(games) < MIN_GAMES:
            continue
        standings.append([
            season, team_id, len(games),
            sum(int(g["team_winner"]) for g in games),
            avg([num(g["team_score"]) for g in games]),
            avg([num(g["assists"]) for g in games]),
            avg([num(g["fouls"]) for g in games]),
            avg([num(g["steals"]) for g in games]),
            avg([num(g["blocks"]) for g in games]),
            avg([num(g["total_rebounds"]) for g in games]),
        ])

    # ---- games, keyed "teamId:season"
    # [date MM-DD, home 1/0, score, won 1/0, opponent score, opponent team id,
    #  assists, fouls, steals, blocks, rebounds, fg pct, three point attempts]
    paired = defaultdict(list)
    for r in rows:
        paired[r["game_id"]].append(r)

    games_by_key = defaultdict(list)
    for pair in paired.values():
        if len(pair) != 2:
            continue
        for me, them in ((pair[0], pair[1]), (pair[1], pair[0])):
            games_by_key[f'{me["team_id"]}:{me["season"]}'].append([
                me["game_date"][5:],
                1 if me["team_home_away"] == "home" else 0,
                num(me["team_score"]),
                int(me["team_winner"]),
                num(them["team_score"]),
                int(them["team_id"]),
                num(me["assists"]),
                num(me["fouls"]),
                num(me["steals"]),
                num(me["blocks"]),
                num(me["total_rebounds"]),
                num(me["field_goal_pct"]),
                num(me["three_point_field_goals_attempted"]),
            ])
    for game_rows in games_by_key.values():
        game_rows.sort(key=lambda g: g[0])

    payload = {
        "teams": {str(k): v for k, v in sorted(teams.items())},
        "seasons": seasons,
        "standings": standings,
        "games": dict(sorted(games_by_key.items())),
    }

    out = out_dir / "sample.js"
    out.write_text(
        "window.SAMPLE_DATA = " + json.dumps(payload, separators=(",", ":")) + ";",
        encoding="utf-8")

    total_games = sum(len(v) for v in games_by_key.values())
    print(f"\nWrote {out} ({out.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"  {len(teams)} teams, {len(seasons)} seasons, "
          f"{len(standings)} team-seasons, {total_games:,} game rows")


if __name__ == "__main__":
    main()
