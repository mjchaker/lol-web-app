# Rift Recap — lol-web-app

A web application that shows recent League of Legends game information for a
summoner, powered by the [Riot Games API](https://developer.riotgames.com).

- Summoner profile icon front and centre, with the Riot ID below it
- Rows of recent games showing the **champion played**, **game duration** and
  **victory / defeat**
- Clicking a row expands it to reveal **KDA**, **KDA ratio**, **game mode**
  (Draft, Ranked Solo/Duo, Ranked Flex, ARAM, …), **which team won**
  (Blue/Red side), your team, CS and gold
- Modern design with a **dark / light mode** toggle (remembers your choice,
  defaults to your system preference)
- **Background music** that starts automatically — no button to press
  (browsers block audible autoplay until the first interaction, so playback
  begins immediately where allowed and otherwise on your first click/keypress)

Backend: Python (Flask). Frontend: HTML, CSS and vanilla JavaScript.
Champion and profile-icon images come from Riot's Data Dragon CDN.

## Quick start

### macOS (Homebrew Python)

Homebrew-managed Python is [externally managed](https://peps.python.org/pep-0668/),
so `pip install` outside a virtual environment fails with an
`externally-managed-environment` error. Use a venv:

```bash
brew install python         # if you don't have it yet

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # then edit .env
export $(grep -v '^#' .env | xargs)

python app.py               # http://localhost:5000
```

On later runs you only need `source .venv/bin/activate` before `python app.py`.

### Linux / other

```bash
pip install -r requirements.txt

cp .env.example .env        # then edit .env
export $(grep -v '^#' .env | xargs)

python app.py               # http://localhost:5000
```

(A virtual environment as shown above works everywhere and is recommended on
any distro whose system Python is also externally managed, e.g. Debian/Ubuntu.)

### VS Code

The repo ships debug configuration in `.vscode/`. Create the venv and install
requirements as above, let VS Code pick up `./.venv` as the interpreter (or
select it via **Python: Select Interpreter**), then press **F5** — the
"Run Rift Recap" launch config starts the server with your `.env` applied.

No `RIOT_API_KEY`? The app runs in **demo mode** with sample data so you can
try the UI right away.

## Configuration

| Variable        | Description                                     | Default        |
| --------------- | ----------------------------------------------- | -------------- |
| `RIOT_API_KEY`  | Riot developer API key (demo mode when unset)   | —              |
| `RIOT_ID`       | Riot ID, `GameName#TagLine`                     | `Summoner#EUW` |
| `RIOT_PLATFORM` | Platform routing value (`euw1`, `na1`, `kr`, …) | `euw1`         |
| `MATCH_COUNT`   | Number of recent matches (max 20)               | `10`           |
| `MUSIC_URL`     | URL of the background music track               | —              |

## Background music

The player picks the first available source, in this order:

1. `static/audio/summoners-rift.mp3` — drop the official Summoner's Rift
   theme (or any track you like) here; the file is gitignored.
2. `MUSIC_URL` — a direct audio URL (mp3/ogg/wav), **or a YouTube link**
   (`youtube.com/watch?v=…`, `youtu.be/…`, shorts/embed links). YouTube
   links play through a hidden looping YouTube IFrame player, since the
   browser's `<audio>` element can't stream a YouTube page. If the video
   owner has disabled embedding, the app falls back to the ambient loop.
3. `static/audio/rift-ambience.wav` — a bundled royalty-free ambient loop, so
   music always works out of the box.

## Riot API endpoints used

- `account-v1` — resolves the Riot ID to a PUUID
- `summoner-v4` — profile icon and summoner level
- `match-v5` — recent match IDs and full match details

Responses are cached in memory (matches for 24 h, the match list for 2 min)
to stay well within development rate limits.

---

*Rift Recap isn't endorsed by Riot Games and doesn't reflect the views or
opinions of Riot Games or anyone officially involved in producing or managing
League of Legends.*
