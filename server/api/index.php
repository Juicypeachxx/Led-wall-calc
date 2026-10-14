<?php
/* ============================================================
   LED WALL PLANNER ON YOUR OWN SERVER
   Keeps projects, your panels and settings in a MariaDB (or MySQL)
   database for everyone who signs in with the planner's shared password.
   The planner (index.html, one folder up) finds this file as
   api/index.php and uses it instead of the browser's own storage.
   Setup: NAS.md in the planner's repository. Needs PHP 7.4 or later
   with the pdo_mysql extension.
   ============================================================ */
declare(strict_types=1);

const API_VERSION = 1;
const SIGN_IN_DAYS = 30;              // how long a sign-in lasts on a device
const MAX_BODY = 8 * 1024 * 1024;     // largest request (a project is usually a few kB)
const LOCK_AFTER = 10;                // wrong passwords from one address ...
const LOCK_SECONDS = 900;             // ... lock it out for this long

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function reply(int $code, array $data): void {
  http_response_code($code);
  // every answer carries "planner", so the planner can tell this API from another one on the same site
  echo json_encode(['planner' => 'led'] + $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
  exit;
}
function fail(int $code, string $error, string $message = ''): void {
  reply($code, ['ok' => false, 'error' => $error, 'message' => $message]);
}

set_exception_handler(function (Throwable $e): void {
  error_log('LED Wall Planner API: ' . $e->getMessage());
  fail(500, 'server', 'The server could not do that. Details are in the PHP error log.');
});

/* ---------- settings (config.php, made from config.sample.php) ---------- */
$cfg = is_file(__DIR__ . '/config.php') ? include __DIR__ . '/config.php' : null;
if (!is_array($cfg)) fail(500, 'setup', 'api/config.php is missing. Copy config.sample.php to config.php and fill it in.');
$password = (string)($cfg['password'] ?? '');
if (strlen($password) < 8 || strpos($password, 'change-this') === 0) fail(500, 'setup', 'Set the shared password (at least 8 characters) in api/config.php.');

/* ---------- signing in ----------
   A signed cookie, valid for SIGN_IN_DAYS, sent only to this api folder. Changing the password in
   config.php signs everyone out. Requests that change data must carry the X-LED-Planner header, which
   a page on another site cannot send here, and the cookie is SameSite=Strict. */
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
$cookiePath = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/'))), '/') . '/';
$secret = hash('sha256', 'led-planner|' . $password . '|' . (string)($cfg['db_pass'] ?? '') . '|' . __DIR__);

function token(int $expires, string $secret): string { return $expires . '.' . hash_hmac('sha256', 'led|' . $expires, $secret); }
function signedIn(string $secret): bool {
  $t = (string)($_COOKIE['led_planner'] ?? '');
  if (!preg_match('/^(\d{9,12})\.[0-9a-f]{64}$/', $t, $m)) return false;
  return (int)$m[1] > time() && hash_equals(token((int)$m[1], $secret), $t);
}
function setSignIn(string $value, int $expires, string $path, bool $https): void {
  setcookie('led_planner', $value, ['expires' => $expires, 'path' => $path, 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
}

/* ---------- the database ----------
   Works with either PHP database driver, PDO (pdo_mysql) or mysqli, whichever this PHP has
   ('db_driver' in config.php can pick one). Statements use ? placeholders. */
final class Db {
  private $pdo = null;
  private $my = null;
  public function __construct(array $cfg) {
    $host = (string)($cfg['db_host'] ?? '127.0.0.1'); $port = (int)($cfg['db_port'] ?? 3307);
    $name = (string)($cfg['db_name'] ?? 'led_planner'); $user = (string)($cfg['db_user'] ?? ''); $pass = (string)($cfg['db_pass'] ?? '');
    $driver = (string)($cfg['db_driver'] ?? 'auto');
    if ($driver === 'auto') $driver = extension_loaded('pdo_mysql') ? 'pdo' : (extension_loaded('mysqli') ? 'mysqli' : '');
    if ($driver === 'pdo') {
      $this->pdo = new PDO("mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4", $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false,
      ]);
    } elseif ($driver === 'mysqli') {
      mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
      $this->my = new mysqli($host, $user, $pass, $name, $port);
      $this->my->set_charset('utf8mb4');
    } else {
      fail(500, 'setup', 'This PHP has no MariaDB driver. Turn on the extension pdo_mysql (or mysqli) in the PHP of this site.');
    }
  }
  // the rows a statement returns (none for statements that change data)
  public function rows(string $sql, array $params = []): array {
    if ($this->pdo) {
      $q = $this->pdo->prepare($sql); $q->execute($params);
      return $q->columnCount() ? $q->fetchAll() : [];
    }
    if (!$params) { $r = $this->my->query($sql); return $r instanceof mysqli_result ? $r->fetch_all(MYSQLI_ASSOC) : []; }
    $q = $this->my->prepare($sql);
    $types = '';
    foreach ($params as $v) $types .= is_int($v) ? 'i' : (is_float($v) ? 'd' : 's');
    $q->bind_param($types, ...$params);
    $q->execute();
    $r = $q->get_result();
    $rows = $r instanceof mysqli_result ? $r->fetch_all(MYSQLI_ASSOC) : [];
    $q->close();
    return $rows;
  }
  public function one(string $sql, array $params = []): ?array { $r = $this->rows($sql, $params); return $r ? $r[0] : null; }
  public function run(string $sql, array $params = []): void { $this->rows($sql, $params); }
  public function begin(): void { if ($this->pdo) $this->pdo->beginTransaction(); else $this->my->begin_transaction(); }
  public function commit(): void { if ($this->pdo) $this->pdo->commit(); else $this->my->commit(); }
}
function db(array $cfg): Db {
  static $db = null;
  if ($db) return $db;
  try {
    $db = new Db($cfg);
  } catch (Throwable $e) {
    $code = (int)$e->getCode();
    $hint = [1045 => 'the user name or password is wrong, or this user may not connect from here', 1044 => 'the user may not use this database', 1049 => 'the database does not exist',
      2002 => 'no database server answers at that host and port', 2005 => 'the host name is unknown'][$code] ?? 'see the PHP error log';
    error_log('LED Wall Planner API: database connection failed: ' . $e->getMessage());
    fail(500, 'db', "Could not connect to the database ($hint). Check db_host, db_port, db_name, db_user and db_pass in api/config.php.");
  }
  install($db);
  return $db;
}
// the tables, made the first time they are needed
function install(Db $db): void {
  $t = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
  $db->run("CREATE TABLE IF NOT EXISTS led_projects (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(200) NOT NULL DEFAULT '',
    client VARCHAR(200) NOT NULL DEFAULT '',
    revision VARCHAR(20) NOT NULL DEFAULT '',
    screens INT NOT NULL DEFAULT 0,
    cabinets INT NOT NULL DEFAULT 0,
    book_from DATE NULL,
    book_to DATE NULL,
    updated VARCHAR(40) NOT NULL DEFAULT '',
    saved TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    project LONGTEXT NOT NULL,
    KEY booked (book_from, book_to)
  )$t");
  $db->run("CREATE TABLE IF NOT EXISTS led_panels (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    brand VARCHAR(60) NOT NULL DEFAULT '',
    model VARCHAR(100) NOT NULL DEFAULT '',
    width_mm DOUBLE NOT NULL,
    height_mm DOUBLE NOT NULL,
    px INT NOT NULL,
    py INT NOT NULL,
    kg DOUBLE NULL,
    w_max DOUBLE NULL,
    w_avg DOUBLE NULL,
    stock INT NULL,
    sort INT NOT NULL DEFAULT 0
  )$t");
  $db->run("CREATE TABLE IF NOT EXISTS led_docs (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    saved TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    doc LONGTEXT NOT NULL
  )$t");
  $db->run("CREATE TABLE IF NOT EXISTS led_logins (
    ip VARCHAR(64) NOT NULL PRIMARY KEY,
    fails INT NOT NULL DEFAULT 0,
    first_fail INT NOT NULL DEFAULT 0
  )$t");
}

/* ---------- helpers ---------- */
// the visitor's address; behind the NAS's own proxy (a site in a container) the proxy adds it as the last X-Forwarded-For entry
function clientIp(): string {
  $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
  $fwd = trim((string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
  if ($fwd !== '' && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
    $parts = array_map('trim', explode(',', $fwd));
    $last = end($parts);
    if (filter_var($last, FILTER_VALIDATE_IP)) $ip = $last;
  }
  return substr($ip === '' ? 'unknown' : $ip, 0, 64);
}
function validId($id): bool { return is_string($id) && preg_match('/^[A-Za-z0-9_.~:@+-]{1,64}$/', $id) === 1; }
// text cut to $max characters (whole UTF-8 characters, without needing mbstring)
function str($v, int $max): string { $s = is_scalar($v) ? (string)$v : ''; return preg_match('/^.{0,' . $max . '}/us', $s, $m) ? $m[0] : substr($s, 0, $max); }
function numOrNull($v): ?float { return is_numeric($v) ? (float)$v : null; }
function day($v): ?string { return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) && checkdate((int)substr($v, 5, 2), (int)substr($v, 8, 2), (int)substr($v, 0, 4)) ? $v : null; }
function projectSummary(array $row): array {
  return ['kind' => 'project', 'id' => $row['id'], 'name' => $row['name'], 'client' => $row['client'], 'revision' => $row['revision'], 'updated' => $row['updated'],
    'screens' => (int)$row['screens'], 'cabinets' => (int)$row['cabinets'], 'bookFrom' => $row['book_from'], 'bookTo' => $row['book_to']];
}
function panelFromRow(array $r): array {
  $name = $r['brand'] === '' ? $r['model'] : (stripos($r['model'], $r['brand']) === 0 ? $r['model'] : $r['brand'] . ' ' . $r['model']);
  return ['id' => $r['id'], 'brand' => $r['brand'], 'model' => $r['model'], 'name' => $name, 'w' => (float)$r['width_mm'], 'h' => (float)$r['height_mm'], 'px' => (int)$r['px'], 'py' => (int)$r['py'],
    'kg' => $r['kg'] === null ? null : (float)$r['kg'], 'wMax' => $r['w_max'] === null ? null : (float)$r['w_max'], 'wAvg' => $r['w_avg'] === null ? null : (float)$r['w_avg'],
    'stock' => $r['stock'] === null ? null : (int)$r['stock'], 'builtin' => false];
}

/* ---------- the request ---------- */
$a = (string)($_GET['a'] ?? '');
$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
$body = [];
if ($method === 'POST') {
  if (($_SERVER['HTTP_X_LED_PLANNER'] ?? '') !== '1') fail(403, 'header', 'Requests that change data come from the planner only.');
  $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
  if ($raw === false || strlen($raw) > MAX_BODY) fail(413, 'size', 'The request is too large.');
  $body = $raw === '' ? [] : json_decode($raw, true);
  if (!is_array($body)) fail(400, 'json', 'The request is not valid JSON.');
} elseif ($method !== 'GET') fail(405, 'method', 'Use GET or POST.');

if ($a === 'me') {
  $in = signedIn($secret);
  if ($in) db($cfg);   // signed in: report a database problem right away
  reply(200, ['ok' => true, 'version' => API_VERSION, 'signedIn' => $in]);
}

if ($a === 'login') {
  if ($method !== 'POST') fail(405, 'method', 'Use POST.');
  $db = db($cfg);
  $ip = clientIp();
  $row = $db->one('SELECT fails, first_fail FROM led_logins WHERE ip = ?', [$ip]) ?: ['fails' => 0, 'first_fail' => 0];
  $recent = time() - (int)$row['first_fail'] < LOCK_SECONDS;
  if ($recent && (int)$row['fails'] >= LOCK_AFTER) fail(429, 'locked', 'Too many wrong passwords. Try again in 15 minutes.');
  if (!hash_equals(hash('sha256', $password), hash('sha256', (string)($body['password'] ?? '')))) {
    usleep(600000);   // slows down guessing
    $db->run('REPLACE INTO led_logins (ip, fails, first_fail) VALUES (?, ?, ?)', [$ip, $recent ? (int)$row['fails'] + 1 : 1, $recent ? (int)$row['first_fail'] : time()]);
    fail(401, 'password', 'Wrong password.');
  }
  $db->run('DELETE FROM led_logins WHERE ip = ?', [$ip]);
  $expires = time() + SIGN_IN_DAYS * 86400;
  setSignIn(token($expires, $secret), $expires, $cookiePath, $https);
  reply(200, ['ok' => true]);
}

if ($a === 'logout') {
  if ($method !== 'POST') fail(405, 'method', 'Use POST.');
  setSignIn('', time() - 3600, $cookiePath, $https);
  reply(200, ['ok' => true]);
}

/* everything below needs a sign-in */
if (!signedIn($secret)) fail(401, 'login', 'Sign in with the planner password.');
$db = db($cfg);

// list: the saved projects, without their contents
if ($a === 'list') {
  $rows = $db->rows('SELECT id, name, client, revision, updated, screens, cabinets, book_from, book_to FROM led_projects ORDER BY updated DESC');
  reply(200, ['ok' => true, 'docs' => array_map(function ($r) { return ['id' => $r['id'], 'data' => projectSummary($r)]; }, $rows)]);
}

// booked: the projects whose booking dates touch from..to, with their contents
if ($a === 'booked') {
  $from = day($_GET['from'] ?? null); $to = day($_GET['to'] ?? null);
  if (!$from || !$to) fail(400, 'dates', 'Give from and to as YYYY-MM-DD.');
  $rows = $db->rows('SELECT * FROM led_projects WHERE book_from IS NOT NULL AND book_to IS NOT NULL AND book_from <= ? AND book_to >= ? ORDER BY book_from', [$to, $from]);
  reply(200, ['ok' => true, 'docs' => array_map(function ($r) { return ['id' => $r['id'], 'data' => projectSummary($r) + ['project' => json_decode($r['project'], true)]]; }, $rows)]);
}

// get: one document: a project, your panels (_library), or another stored document (_settings, ...)
if ($a === 'get') {
  $id = $_GET['id'] ?? '';
  if (!validId($id)) fail(400, 'id', 'Not a valid id.');
  if ($id === '_library') {
    $panels = array_map('panelFromRow', $db->rows('SELECT * FROM led_panels ORDER BY sort, brand, model'));
    $doc = $db->one("SELECT doc FROM led_docs WHERE id = '_library'");
    $meta = $doc ? (json_decode((string)$doc['doc'], true) ?: []) : [];
    reply(200, ['ok' => true, 'exists' => (bool)$doc || count($panels) > 0, 'doc' => ['kind' => 'library', 'panels' => $panels, 'updated' => $meta['updated'] ?? null]]);
  }
  if ($r = $db->one('SELECT * FROM led_projects WHERE id = ?', [$id])) reply(200, ['ok' => true, 'exists' => true, 'doc' => projectSummary($r) + ['project' => json_decode($r['project'], true)]]);
  $doc = $db->one('SELECT doc FROM led_docs WHERE id = ?', [$id]);
  reply(200, ['ok' => true, 'exists' => (bool)$doc, 'doc' => $doc ? json_decode((string)$doc['doc'], true) : null]);
}

// set: save one document
if ($a === 'set') {
  if ($method !== 'POST') fail(405, 'method', 'Use POST.');
  $id = $body['id'] ?? ''; $doc = $body['doc'] ?? null;
  if (!validId($id) || !is_array($doc)) fail(400, 'doc', 'Send an id and a document.');
  $kind = (string)($doc['kind'] ?? '');
  if ($kind === 'project') {
    $p = $doc['project'] ?? null;
    if (!is_array($p) || !isset($p['screens']) || !is_array($p['screens'])) fail(400, 'project', 'Not a project.');
    $st = is_array($p['settings'] ?? null) ? $p['settings'] : [];
    $from = day($st['bookFrom'] ?? null); $to = day($st['bookTo'] ?? null);
    if ($from && $to && $to < $from) [$from, $to] = [$to, $from];
    if (!$from || !$to) $from = $to = null;
    $db->run('REPLACE INTO led_projects (id, name, client, revision, screens, cabinets, book_from, book_to, updated, project) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [$id, str($p['name'] ?? '', 200), str($p['client'] ?? '', 200), str($p['revision'] ?? '', 20), count($p['screens']), (int)($doc['cabinets'] ?? 0),
        $from, $to, str($p['updated'] ?? '', 40), json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)]);
    reply(200, ['ok' => true]);
  }
  if ($id === '_library') {
    $panels = is_array($doc['panels'] ?? null) ? array_values($doc['panels']) : [];
    $db->begin();
    $db->run('DELETE FROM led_panels');
    $seen = [];
    foreach ($panels as $i => $c) {
      if (!is_array($c) || !validId($c['id'] ?? null) || isset($seen[$c['id']]) || !is_numeric($c['w'] ?? null) || !is_numeric($c['h'] ?? null) || !is_numeric($c['px'] ?? null) || !is_numeric($c['py'] ?? null)) continue;
      $seen[$c['id']] = true;
      $stock = numOrNull($c['stock'] ?? null);
      $db->run('INSERT INTO led_panels (id, brand, model, width_mm, height_mm, px, py, kg, w_max, w_avg, stock, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [$c['id'], str($c['brand'] ?? '', 60), str($c['model'] ?? ($c['name'] ?? ''), 100), (float)$c['w'], (float)$c['h'], (int)$c['px'], (int)$c['py'],
        numOrNull($c['kg'] ?? null), numOrNull($c['wMax'] ?? null), numOrNull($c['wAvg'] ?? null), $stock === null ? null : (int)round($stock), $i]);
    }
    $db->run('REPLACE INTO led_docs (id, doc) VALUES (?, ?)', ['_library', json_encode(['kind' => 'library', 'updated' => str($doc['updated'] ?? '', 40)])]);
    $db->commit();
    reply(200, ['ok' => true]);
  }
  if ($id[0] !== '_') fail(400, 'doc', 'Only projects have plain ids.');
  $db->run('REPLACE INTO led_docs (id, doc) VALUES (?, ?)', [$id, json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)]);
  reply(200, ['ok' => true]);
}

// del: delete one document
if ($a === 'del') {
  if ($method !== 'POST') fail(405, 'method', 'Use POST.');
  $id = $body['id'] ?? '';
  if (!validId($id)) fail(400, 'id', 'Not a valid id.');
  $db->run('DELETE FROM led_projects WHERE id = ?', [$id]);
  $db->run('DELETE FROM led_docs WHERE id = ?', [$id]);
  reply(200, ['ok' => true]);
}

fail(404, 'action', 'Unknown request.');
