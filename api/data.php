<?php
// Single data endpoint for the dashboard.
// Every request is api/data.php?type=... and comes back as JSON from MySQL.
//
//   ?type=seasons                         league averages per season
//   ?type=standings&season=&q=            ranked teams for one season
//   ?type=team_seasons&team_id=           one team's record by season
//   ?type=games&team_id=&season=          every game for one team in a season
//
// config.php holds the database credentials and is not submitted.

declare(strict_types=1);
require_once __DIR__ . '/config.php';

header('Content-Type: application/json');

$type    = $_GET['type'] ?? '';
$season  = isset($_GET['season']) ? (int) $_GET['season'] : 2026;
$team_id = isset($_GET['team_id']) ? (int) $_GET['team_id'] : 0;
$search  = trim((string) ($_GET['q'] ?? ''));

$params = [];

switch ($type) {

  case 'seasons':
    $sql = "
      SELECT
        `season`,
        COUNT(DISTINCT `game_id`) AS `games`,
        ROUND(AVG(`team_score`), 2) AS `avg_points`,
        ROUND(AVG(`assists`), 2) AS `avg_assists`,
        ROUND(AVG(`fouls`), 2) AS `avg_fouls`,
        ROUND(AVG(`steals`), 2) AS `avg_steals`,
        ROUND(AVG(`blocks`), 2) AS `avg_blocks`,
        ROUND(AVG(`three_point_field_goals_attempted`), 2) AS `avg_three_pt_attempts`,
        ROUND(AVG(`offensive_rebounds`), 2) AS `avg_offensive_rebounds`,
        ROUND(AVG(`defensive_rebounds`), 2) AS `avg_defensive_rebounds`
      FROM `team_game`
      WHERE `season` >= 2014
      GROUP BY `season`
      ORDER BY `season`
    ";
    break;

  case 'standings':
    $sql = "
      SELECT
        `s`.`team_id`,
        `s`.`team_abbreviation`,
        `s`.`team_display_name`,
        `t`.`team_color`,
        `s`.`games_played`,
        `s`.`wins`,
        `s`.`losses`,
        `s`.`win_rate`,
        `s`.`avg_points`,
        `s`.`avg_assists`,
        `s`.`avg_fouls`,
        `s`.`avg_steals`,
        `s`.`avg_blocks`,
        `s`.`avg_total_rebounds`
      FROM `team_season_summary` `s`
      JOIN `team` `t` ON `t`.`team_id` = `s`.`team_id`
      WHERE `s`.`season` = :season
        AND `s`.`games_played` >= 15
    ";
    $params[':season'] = $season;
    if ($search !== '') {
      $sql .= " AND (`s`.`team_display_name` LIKE :q OR `s`.`team_abbreviation` LIKE :q)";
      $params[':q'] = '%' . $search . '%';
    }
    $sql .= " ORDER BY `s`.`win_rate` DESC, `s`.`avg_points` DESC";
    break;

  case 'team_seasons':
    $sql = "
      SELECT
        `season`,
        `team_id`,
        `team_abbreviation`,
        `team_display_name`,
        `games_played`,
        `wins`,
        `losses`,
        `win_rate`,
        `avg_points`
      FROM `team_season_summary`
      WHERE `team_id` = :team_id
        AND `games_played` >= 15
      ORDER BY `season`
    ";
    $params[':team_id'] = $team_id;
    break;

  case 'games':
    $sql = "
      SELECT
        `g`.`game_date`,
        `g`.`team_home_away`,
        `g`.`team_score`,
        `g`.`team_winner`,
        `og`.`team_score` AS `opponent_score`,
        `o`.`team_display_name` AS `opponent`,
        `g`.`assists`,
        `g`.`fouls`,
        `g`.`steals`,
        `g`.`blocks`,
        `g`.`total_rebounds`,
        `g`.`field_goal_pct`,
        `g`.`three_point_field_goals_attempted`
      FROM `team_game` `g`
      JOIN `team_game` `og` ON `og`.`game_id` = `g`.`game_id` AND `og`.`team_id` <> `g`.`team_id`
      JOIN `team` `o` ON `o`.`team_id` = `og`.`team_id`
      WHERE `g`.`team_id` = :team_id
        AND `g`.`season` = :season
      ORDER BY `g`.`game_date`
    ";
    $params[':team_id'] = $team_id;
    $params[':season'] = $season;
    break;

  default:
    http_response_code(400);
    echo json_encode(['error' => 'Unknown type']);
    exit;
}

try {
  $pdo = new PDO(
    sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', DB_HOST, DB_NAME),
    DB_USER,
    DB_PASS,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
     PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
  );
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();

  // PDO returns MySQL numbers as strings; convert them so JavaScript can chart them.
  foreach ($rows as &$row) {
    foreach ($row as $key => $value) {
      if (is_string($value) && is_numeric($value)) {
        $row[$key] = $value + 0;
      }
    }
  }

  echo json_encode($rows);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['error' => $e->getMessage()]);
}
