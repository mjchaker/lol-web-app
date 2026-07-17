"""Summoner Rift Recap — a small Flask app that shows recent League of Legends
match history for a configured summoner, powered by the Riot Games API.

Configuration (environment variables, see .env.example):
    RIOT_API_KEY   Riot developer API key. Without it the app runs in demo mode.
    RIOT_ID        Riot ID of the summoner, e.g. "Faker#KR1".
    RIOT_PLATFORM  Platform routing value, e.g. euw1, na1, kr (default: euw1).
    MATCH_COUNT    Number of recent matches to show (default: 10, max 20).
    MUSIC_URL      Optional URL of the background music track.
"""
import os
import time

import requests
from flask import Flask, jsonify, render_template

app = Flask(__name__)

RIOT_API_KEY = os.environ.get("RIOT_API_KEY", "").strip()
RIOT_ID = os.environ.get("RIOT_ID", "Summoner#EUW").strip()
RIOT_PLATFORM = os.environ.get("RIOT_PLATFORM", "euw1").strip().lower()
MATCH_COUNT = min(int(os.environ.get("MATCH_COUNT", "10")), 20)
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
        try:
            return requests.get(
                "https://ddragon.leagueoflegends.com/api/versions.json", timeout=10
            ).json()[0]
        except Exception:
            return "15.13.1"  # reasonable fallback if the CDN is unreachable
    return cached("ddragon_version", 6 * 3600, fetch)


def get_account():
    game_name, _, tag_line = RIOT_ID.partition("#")
    url = (f"https://{REGION}.api.riotgames.com/riot/account/v1/accounts/"
           f"by-riot-id/{game_name}/{tag_line}")
    return cached("account", 3600, lambda: riot_get(url))


def get_summoner(puuid):
    url = (f"https://{RIOT_PLATFORM}.api.riotgames.com/lol/summoner/v4/"
           f"summoners/by-puuid/{puuid}")
    return cached("summoner", 300, lambda: riot_get(url))


def champion_key(name):
    return CHAMPION_KEY_FIXES.get(name, name)


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
        "durationSec": info["gameDuration"],
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
    return {
        "gameName": RIOT_ID.partition("#")[0],
        "tagLine": RIOT_ID.partition("#")[2] or "DEMO",
        "level": 214,
        "profileIconId": 4658,
        "demo": True,
    }


def demo_matches():
    import random
    rng = random.Random(42)
    champs = ["Ahri", "Yasuo", "Jinx", "Thresh", "LeeSin", "Lux",
              "Ezreal", "KaiSa", "Garen", "Viego"]
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
    try:
        account = get_account()
        summoner = get_summoner(account["puuid"])
        return jsonify({
            "gameName": account["gameName"],
            "tagLine": account["tagLine"],
            "level": summoner["summonerLevel"],
            "profileIconId": summoner["profileIconId"],
            "demo": False,
        })
    except requests.HTTPError as e:
        return jsonify({"error": f"Riot API error: {e.response.status_code}"}), 502
    except requests.RequestException as e:
        return jsonify({"error": f"Could not reach the Riot API: {e}"}), 502


@app.route("/api/matches")
def api_matches():
    if DEMO_MODE:
        return jsonify(demo_matches())
    try:
        account = get_account()
        return jsonify(cached("matches", 120, lambda: fetch_matches(account["puuid"])))
    except requests.HTTPError as e:
        return jsonify({"error": f"Riot API error: {e.response.status_code}"}), 502
    except requests.RequestException as e:
        return jsonify({"error": f"Could not reach the Riot API: {e}"}), 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
