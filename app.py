"""Summoner Rift Recap — a small Flask app that shows recent League of Legends
match history for a configured summoner, powered by the Riot Games API.

Configuration (environment variables, see .env.example; a `.env` file next to
this script is loaded automatically):
    RIOT_API_KEY   Riot developer API key. Without it the app runs in demo mode.
    RIOT_ID        Riot ID of the summoner, e.g. "Faker#KR1".
    RIOT_PLATFORM  Platform routing value, e.g. euw1, na1, kr (default: euw1).
    MATCH_COUNT    Number of recent matches to show (default: 10, max 20).
    MUSIC_URL      Optional URL of the background music track.
"""
import os
import time
from urllib.parse import quote

import requests
from flask import Flask, jsonify, render_template

app = Flask(__name__)

MAX_MATCH_COUNT = 20
DEFAULT_MATCH_COUNT = 10


def load_dotenv(path):
    """Load KEY=VALUE pairs from a .env file into os.environ.

    Values already present in the environment win, so `.env` acts as a set of
    defaults. Blank lines and `#` comments are ignored; a leading `export ` and
    surrounding single/double quotes are stripped. Unlike `export $(cat .env)`
    this keeps values containing spaces (e.g. "Hide on bush#KR1") intact.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


def parse_match_count(raw):
    try:
        count = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_MATCH_COUNT
    return max(1, min(count, MAX_MATCH_COUNT))


RIOT_API_KEY = os.environ.get("RIOT_API_KEY", "").strip()
RIOT_ID = os.environ.get("RIOT_ID", "").strip() or "Summoner#EUW"
RIOT_PLATFORM = os.environ.get("RIOT_PLATFORM", "").strip().lower() or "euw1"
MATCH_COUNT = parse_match_count(os.environ.get("MATCH_COUNT", ""))
MUSIC_URL = os.environ.get("MUSIC_URL", "").strip()

DEMO_MODE = not RIOT_API_KEY

# Platform routing value -> regional routing value (for account-v1 / match-v5)
PLATFORM_TO_REGION = {
    "na1": "americas", "br1": "americas", "la1": "americas", "la2": "americas",
    "euw1": "europe", "eun1": "europe", "tr1": "europe", "ru": "europe", "me1": "europe",
    "kr": "asia", "jp1": "asia",
    "oc1": "sea", "ph2": "sea", "sg2": "sea", "th2": "sea", "tw2": "sea", "vn2": "sea",
}
REGION = PLATFORM_TO_REGION.get(RIOT_PLATFORM, "europe")

QUEUE_MODES = {
    400: "Normal Draft",
    420: "Ranked Solo/Duo",
    430: "Normal Blind",
    440: "Ranked Flex",
    450: "ARAM",
    480: "Swiftplay",
    490: "Quickplay",
    700: "Clash",
    830: "Co-op vs. AI",
    840: "Co-op vs. AI",
    850: "Co-op vs. AI",
    900: "ARURF",
    1400: "Ultimate Spellbook",
    1700: "Arena",
    1900: "URF",
}

# match-v5 champion names that differ from Data Dragon image keys
CHAMPION_KEY_FIXES = {"FiddleSticks": "Fiddlesticks"}

DDRAGON_FALLBACK_VERSION = "15.13.1"

_cache: dict = {}


def cached(key, ttl, fn):
    """Tiny in-memory TTL cache so we stay well inside Riot rate limits."""
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (now, value)
    return value


def riot_get(url):
    resp = requests.get(url, headers={"X-Riot-Token": RIOT_API_KEY}, timeout=10)
    resp.raise_for_status()
    return resp.json()


def ddragon_version():
    def fetch():
        resp = requests.get(
            "https://ddragon.leagueoflegends.com/api/versions.json", timeout=10)
        resp.raise_for_status()
        return resp.json()[0]
    try:
        return cached("ddragon_version", 6 * 3600, fetch)
    except Exception:
        # CDN unreachable: use a known version but don't cache it, so the next
        # request tries again instead of serving stale art for six hours.
        return DDRAGON_FALLBACK_VERSION


def split_riot_id(riot_id):
    game_name, _, tag_line = riot_id.partition("#")
    return game_name.strip(), tag_line.strip()


def get_account():
    game_name, tag_line = split_riot_id(RIOT_ID)
    if not game_name or not tag_line:
        raise ValueError(
            f'RIOT_ID must look like "GameName#TagLine" (got "{RIOT_ID}").')
    # Riot IDs may contain spaces and non-ASCII characters: percent-encode them.
    url = (f"https://{REGION}.api.riotgames.com/riot/account/v1/accounts/"
           f"by-riot-id/{quote(game_name, safe='')}/{quote(tag_line, safe='')}")
    return cached("account", 3600, lambda: riot_get(url))


def get_summoner(puuid):
    url = (f"https://{RIOT_PLATFORM}.api.riotgames.com/lol/summoner/v4/"
           f"summoners/by-puuid/{puuid}")
    return cached("summoner", 300, lambda: riot_get(url))


def champion_key(name):
    return CHAMPION_KEY_FIXES.get(name, name)


def game_duration_seconds(info):
    """match-v5 quirk: before patch 11.20 `gameDuration` was in milliseconds.
    Riot's guidance is to treat it as ms when `gameEndTimestamp` is absent."""
    duration = info.get("gameDuration", 0)
    if "gameEndTimestamp" not in info:
        duration //= 1000
    return duration


def summarize_match(match, puuid):
    info = match["info"]
    me = next(p for p in info["participants"] if p["puuid"] == puuid)
    winning_team_id = next(
        (t["teamId"] for t in info["teams"] if t.get("win")), me["teamId"] if me["win"] else None
    )
    deaths = me["deaths"]
    kda = round((me["kills"] + me["assists"]) / max(deaths, 1), 2)
    return {
        "matchId": match["metadata"]["matchId"],
        "champion": champion_key(me["championName"]),
        "championLevel": me["champLevel"],
        "win": me["win"],
        "durationSec": game_duration_seconds(info),
        "mode": QUEUE_MODES.get(info.get("queueId"), info.get("gameMode", "Unknown").title()),
        "kills": me["kills"],
        "deaths": deaths,
        "assists": me["assists"],
        "kda": kda,
        "myTeam": "Blue" if me["teamId"] == 100 else "Red",
        "winningTeam": {100: "Blue", 200: "Red"}.get(winning_team_id, "—"),
        "cs": me.get("totalMinionsKilled", 0) + me.get("neutralMinionsKilled", 0),
        "gold": me.get("goldEarned", 0),
        "endedAt": info.get("gameEndTimestamp") or info.get("gameCreation"),
    }


def fetch_matches(puuid):
    ids_url = (f"https://{REGION}.api.riotgames.com/lol/match/v5/matches/"
               f"by-puuid/{puuid}/ids?start=0&count={MATCH_COUNT}")
    match_ids = riot_get(ids_url)
    matches = []
    for mid in match_ids:
        match = cached(
            f"match:{mid}", 24 * 3600,
            lambda mid=mid: riot_get(
                f"https://{REGION}.api.riotgames.com/lol/match/v5/matches/{mid}"),
        )
        matches.append(summarize_match(match, puuid))
    return matches


# ---------------------------------------------------------------------------
# Demo data — lets the UI run without an API key.
# ---------------------------------------------------------------------------

def demo_profile():
    game_name, tag_line = split_riot_id(RIOT_ID)
    return {
        "gameName": game_name or "Summoner",
        "tagLine": tag_line or "DEMO",
        "level": 214,
        "profileIconId": 4658,
        "demo": True,
    }


def demo_matches():
    import random
    rng = random.Random(42)
    champs = ["Ahri", "Yasuo", "Jinx", "Thresh", "LeeSin", "Lux",
              "Ezreal", "Kaisa", "Garen", "Viego"]
    modes = ["Ranked Solo/Duo", "Ranked Flex", "Normal Draft", "ARAM"]
    now = int(time.time() * 1000)
    matches = []
    for i in range(MATCH_COUNT):
        win = rng.random() > 0.45
        kills, deaths, assists = rng.randint(1, 18), rng.randint(0, 11), rng.randint(2, 22)
        my_team = rng.choice(["Blue", "Red"])
        matches.append({
            "matchId": f"DEMO_{i}",
            "champion": champs[i % len(champs)],
            "championLevel": rng.randint(11, 18),
            "win": win,
            "durationSec": rng.randint(16 * 60, 42 * 60),
            "mode": rng.choice(modes),
            "kills": kills, "deaths": deaths, "assists": assists,
            "kda": round((kills + assists) / max(deaths, 1), 2),
            "myTeam": my_team,
            "winningTeam": my_team if win else ("Red" if my_team == "Blue" else "Blue"),
            "cs": rng.randint(40, 280),
            "gold": rng.randint(6000, 18500),
            "endedAt": now - i * rng.randint(2, 9) * 3600 * 1000,
        })
    return matches


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

RIOT_ERROR_HINTS = {
    400: "the Riot API rejected the request (is RIOT_ID in the form GameName#TagLine?)",
    401: "the Riot API key is missing or malformed",
    403: "the Riot API key is invalid or has expired (development keys last 24 h)",
    404: "no summoner found for that Riot ID on this platform",
    429: "Riot API rate limit reached, please try again in a moment",
    503: "the Riot API is temporarily unavailable",
}


def riot_error_response(status):
    hint = RIOT_ERROR_HINTS.get(status, "unexpected response from the Riot API")
    return jsonify({"error": f"Riot API error {status}: {hint}"}), 502


def riot_call(fn):
    """Run `fn` and turn any failure into a JSON error response, so the
    frontend always receives JSON rather than an HTML 500 page."""
    try:
        return jsonify(fn())
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 0
        return riot_error_response(status)
    except requests.RequestException as e:
        return jsonify({"error": f"Could not reach the Riot API: {e}"}), 502
    except ValueError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:  # unexpected payload shape etc.
        app.logger.exception("Unhandled error while building the response")
        return jsonify({"error": f"Unexpected error: {type(e).__name__}"}), 500


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config")
def api_config():
    return jsonify({
        "ddragonVersion": ddragon_version(),
        "musicUrl": MUSIC_URL,
        "demo": DEMO_MODE,
    })


@app.route("/api/profile")
def api_profile():
    if DEMO_MODE:
        return jsonify(demo_profile())

    def build():
        account = get_account()
        summoner = get_summoner(account["puuid"])
        return {
            "gameName": account["gameName"],
            "tagLine": account["tagLine"],
            "level": summoner["summonerLevel"],
            "profileIconId": summoner["profileIconId"],
            "demo": False,
        }
    return riot_call(build)


@app.route("/api/matches")
def api_matches():
    if DEMO_MODE:
        return jsonify(demo_matches())

    def build():
        account = get_account()
        return cached("matches", 120, lambda: fetch_matches(account["puuid"]))
    return riot_call(build)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
