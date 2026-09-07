#!/usr/bin/env python3
"""Upcoming ITF World Tennis Tour events from itftennis.com, via a headless Chrome.

    ./seed/itf.py [--from YYYY-MM-DD] [--to YYYY-MM-DD] > seed/out/itf.json

Wikipedia's ITF pages are filled in week by week as events are played, so they never
show more than a week or two ahead. itftennis.com has the whole calendar behind
/tennis/api/TournamentApi/GetCalendar, but the site sits behind an Incapsula
JavaScript challenge that a plain HTTP client cannot pass. A real Chrome passes it,
so this script starts one headless, opens the calendar page, and asks the page to
call the API for us over the DevTools protocol. Standard library only on the Python
side; Chrome is the one outside dependency (set ITF_CHROME, or a Playwright
chromium under ~/.cache/ms-playwright, or google-chrome / chromium on PATH). Exits
with status 3 and writes nothing when there is no Chrome, so a refresh without one
still works, just without the ITF lookahead.

Output has the same shape as seed/wikipedia.py: {"season", "generated", "tournaments"}
with one row per event, category "ITF", grade M15/W35..., page "itftennis.com".
"""
import argparse
import base64
import datetime as dt
import glob
import http.client
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

PAGE = "https://www.itftennis.com/en/tournament-calendar/mens-world-tennis-tour-calendar/"
API = "/tennis/api/TournamentApi/GetCalendar"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
CIRCUITS = [("ATP", "MT"), ("WTA", "WT")]
# itftennis.com host nations to the names Wikipedia (and so cities.json) uses.
COUNTRY = {
    "USA": "United States", "Great Britain": "United Kingdom", "China, P.R.": "China", "China P.R.": "China", "Korea, Rep.": "South Korea", "Korea": "South Korea",
    "Chinese Taipei": "Taiwan", "Türkiye": "Turkey", "Turkiye": "Turkey", "Czechia": "Czech Republic",
    "Russian Federation": "Russia", "Iran, Islamic Rep.": "Iran", "Viet Nam": "Vietnam", "Hong Kong, China": "Hong Kong",
    "Macau, China": "Macau", "Moldova, Rep.": "Moldova", "Bosnia & Herzegovina": "Bosnia and Herzegovina",
    "Dominican Rep.": "Dominican Republic", "Slovak Republic": "Slovakia", "North Macedonia": "North Macedonia",
    "Syrian Arab Rep.": "Syria", "Lao PDR": "Laos", "Brunei Darussalam": "Brunei", "Cote d'Ivoire": "Ivory Coast",
    "Trinidad & Tobago": "Trinidad and Tobago", "Congo, Dem. Rep.": "DR Congo", "Tanzania, United Rep.": "Tanzania",
    "El Salvador": "El Salvador", "Kosovo": "Kosovo", "Serbia": "Serbia",
}


# itftennis.com spellings that the geocoder or cities.json do not know.
CITY = {"Sharm ElSheikh": "Sharm El Sheikh", "Qian Daohu": "Qiandaohu", "yanagawa city": "Yanagawa"}


def find_chrome():
    cands = [os.environ.get("ITF_CHROME")] + sorted(glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome")), reverse=True) \
        + [shutil.which(n) for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome")]
    return next((c for c in cands if c and os.path.exists(c)), None)


class DevTools:
    """The smallest WebSocket client that can talk to Chrome's DevTools protocol."""
    def __init__(self, ws_url):
        u = urllib.parse.urlparse(ws_url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=120)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("websocket handshake failed")
            resp += chunk
        if b" 101 " not in resp.split(b"\r\n", 1)[0]:
            raise RuntimeError("websocket handshake refused: " + resp.split(b"\r\n", 1)[0].decode(errors="replace"))
        self.buf = resp.split(b"\r\n\r\n", 1)[1]
        self.n = 0

    def _read(self, k):
        while len(self.buf) < k:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("websocket closed")
            self.buf += chunk
        out, self.buf = self.buf[:k], self.buf[k:]
        return out

    def _recv(self):
        b0, b1 = self._read(2)
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack(">H", self._read(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self._read(8))[0]
        mask = self._read(4) if b1 & 0x80 else None
        data = self._read(n)
        if mask:
            data = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
        return b0 & 0x0F, data

    def send(self, method, **params):
        self.n += 1
        payload = json.dumps({"id": self.n, "method": method, "params": params}).encode()
        mask = os.urandom(4)
        head = bytearray([0x81])
        if len(payload) < 126:
            head.append(0x80 | len(payload))
        elif len(payload) < 65536:
            head.append(0x80 | 126); head += struct.pack(">H", len(payload))
        else:
            head.append(0x80 | 127); head += struct.pack(">Q", len(payload))
        self.sock.sendall(bytes(head) + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload)))
        frames = b""
        while True:
            op, data = self._recv()
            if op == 8:
                raise RuntimeError("websocket closed by Chrome")
            if op in (0, 1):
                frames += data
                try:
                    msg = json.loads(frames)
                except ValueError:
                    continue  # a continuation frame follows
                frames = b""
                if msg.get("id") == self.n:
                    if "error" in msg:
                        raise RuntimeError(msg["error"])
                    return msg.get("result", {})

    def evaluate(self, js):
        r = self.send("Runtime.evaluate", expression=js, awaitPromise=True, returnByValue=True)
        if r.get("exceptionDetails"):
            raise RuntimeError(r["exceptionDetails"].get("text", "evaluate failed"))
        return r["result"].get("value")


def http_json(port, path, method="GET"):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    c.request(method, path)
    r = c.getresponse()
    body = r.read()
    if r.status >= 300:
        raise RuntimeError(f"{path}: {r.status} {body[:200]!r}")
    return json.loads(body)


def with_chrome(chrome, fn):
    """Start a headless Chrome on a free port, run fn(port), and always tear it down."""
    profile = tempfile.mkdtemp(prefix="itf-chrome-")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    proc = subprocess.Popen([chrome, "--headless=new", "--no-sandbox", "--disable-gpu", f"--remote-debugging-port={port}",
                             f"--user-data-dir={profile}", f"--user-agent={UA}", "--no-first-run", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                http_json(port, "/json/version"); break
            except Exception:  # noqa: BLE001
                time.sleep(0.5)
        else:
            raise RuntimeError("Chrome did not start")
        return fn(port)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


def fetch_calendar(port, date_from, date_to):
    target = http_json(port, "/json/new?" + urllib.parse.quote(PAGE, safe=""), method="PUT")
    dev = DevTools(target["webSocketDebuggerUrl"])
    dev.send("Page.enable"); dev.send("Runtime.enable")
    # The first load answers the Incapsula challenge and reloads itself; wait until the app has rendered.
    for _ in range(90):
        time.sleep(1)
        if dev.evaluate("document.querySelectorAll('.whatson-table__tournament').length > 0 && !document.body.innerHTML.includes('_Incapsula_Resource') ? 1 : document.querySelectorAll('.whatson-table__tournament').length"):
            break
    else:
        raise RuntimeError("calendar page never rendered (challenge not passed?)")
    out = {}
    for tour, code in CIRCUITS:
        q = urllib.parse.urlencode({"circuitCode": code, "searchString": "", "skip": 0, "take": 1000, "nationCodes": "", "zoneCodes": "",
                                    "dateFrom": date_from, "dateTo": date_to, "indoorOutdoor": "", "categories": "", "isOrderAscending": "true",
                                    "orderField": "startDate", "surfaceCodes": ""})
        js = f"fetch({json.dumps(API + '?' + q)}, {{credentials: 'same-origin', headers: {{Accept: 'application/json'}}}}).then(r => r.text())"
        text = dev.evaluate(js)
        try:
            out[tour] = json.loads(text)
        except ValueError:
            raise RuntimeError(f"{tour}: the calendar API did not answer JSON: {text[:200]!r}")
        time.sleep(1)
    return out


def iso(s):
    m = re.match(r"(\d{4}-\d{2}-\d{2})", s or "")
    return m.group(1) if m else None


def rows(tour, payload):
    items = payload.get("items") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise RuntimeError(f"{tour}: unexpected calendar payload: {json.dumps(payload)[:300]}")
    out = []
    for it in items:
        name = (it.get("tournamentName") or "").strip()
        grade = re.search(r"\b([MW]\d{2,3})\b", name + " " + str(it.get("category") or it.get("categoryName") or ""))
        start, end = iso(it.get("startDate")), iso(it.get("endDate"))
        if not (start and end and grade):
            continue
        city = (it.get("location") or "").strip() or grade and name.split(" ", 1)[-1].title()
        city = re.sub(r"\s*\((cancelled|postponed|new)\)\s*$", "", city, flags=re.I)  # "Berlin (Cancelled)"
        city = re.sub(r",\s*[A-Z]{2}$", "", city).strip().rstrip(",").strip()  # "Fayetteville, AR", "Columbus,"
        city = CITY.get(city, city)
        if city.isupper() or city.islower():  # "VISERBA DI RIMINI", "villena"
            city = re.sub(r"\b(Di|De|Del|Della|Da|La|Le|Les|Sur|En|Y|Al)\b", lambda m: m.group(1).lower(), city.title())
        country = (it.get("hostNation") or "").strip()
        country = COUNTRY.get(country, country)
        surf = str(it.get("surfaceDesc") or it.get("surface") or "")
        surface = next((s for s in ("Hard", "Clay", "Grass", "Carpet") if s.lower() in surf.lower()), None)
        prize = it.get("prizeMoney")
        prize = prize.strip() if isinstance(prize, str) and prize.strip() else None
        title = f"{grade.group(1)} {city}"
        out.append({
            "tour": tour, "name": title, "city": city, "country": country, "category": "ITF", "surface": surface,
            "start": start, "end": end, "prize": prize, "grade": grade.group(1), "draw": None,
            "cancelled": str(it.get("tourStatusCode") or "") in ("CN", "PP") or bool(re.search(r"\((cancelled|postponed)\)", name, re.I)),
            "played": False, "page": "itftennis.com",
            "link": ("https://www.itftennis.com" + it["tournamentLink"]) if it.get("tournamentLink", "").startswith("/") else None,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    today = dt.date.today()
    ap.add_argument("--from", dest="date_from", default=today.isoformat())
    ap.add_argument("--to", dest="date_to", default=dt.date(today.year, 12, 31).isoformat())
    a = ap.parse_args()
    chrome = find_chrome()
    if not chrome:
        print("itf: no Chrome found (set ITF_CHROME); skipping the ITF lookahead", file=sys.stderr)
        sys.exit(3)
    data = with_chrome(chrome, lambda port: fetch_calendar(port, a.date_from, a.date_to))
    events = [r for tour, payload in data.items() for r in rows(tour, payload)]
    if len(events) < 20:
        print(f"itf: only {len(events)} events parsed, refusing to write; first payload: {json.dumps(data)[:400]}", file=sys.stderr)
        sys.exit(1)
    events.sort(key=lambda e: (e["start"], e["tour"], e["name"]))
    print(f"itf: {len(events)} events {events[0]['start']} to {max(e['end'] for e in events)}", file=sys.stderr)
    json.dump({"season": today.year, "generated": today.isoformat(), "tournaments": events}, sys.stdout, ensure_ascii=False, indent=0)
    print()


if __name__ == "__main__":
    main()
