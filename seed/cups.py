#!/usr/bin/env python3
"""Davis Cup and Billie Jean King Cup ties for one season, from Wikipedia's yearly pages.

    ./seed/cups.py 2026 > cups.json

Each page has tie tables (Home team, Score, Away team, Location, Venue, Surface) under
sections whose prose gives the dates ("6–7 February"). We take the most recent date
mentioned before each table. Ties are placed in the home nation's city.
"""
import datetime as dt
import html
import json
import re
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wikipedia import fetch, Tables, MONTHS  # noqa: E402

PAGES = [("ATP", "Davis Cup", "{y}_Davis_Cup"), ("WTA", "Billie Jean King Cup", "{y}_Billie_Jean_King_Cup")]
NATION_COUNTRY = {"Great Britain": "United Kingdom", "Chinese Taipei": "Taiwan", "Hong Kong, China": "Hong Kong",
                  "Czechia": "Czech Republic", "Türkiye": "Turkey", "USA": "United States", "Korea": "South Korea"}
DATE_RE = re.compile(r"(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?")
FULL = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], 1)}


def strip(s):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).strip()


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else dt.date.today().year
    out = []
    for tour, cup, title in PAGES:
        page = fetch(f"https://en.wikipedia.org/wiki/{title.format(y=year)}")
        # Walk the page in order, accumulating each section's prose. The section says
        # "Date: 5–8 February 2026"; fall back to the first date in the season year.
        pos, section, prose, last_date = 0, cup, "", None
        for m in re.finditer(r"<h[234][^>]*>(.*?)</h[234]>|<table[^>]*>(.*?)</table>", page, re.S):
            prose += " " + strip(page[pos:m.start()])
            pos = m.end()
            if m.group(1) is not None:
                section = re.sub(r"\[\s*edit\s*\]", "", strip(m.group(1))).strip()
                prose = ""
                continue
            dates = [d for d in DATE_RE.finditer(prose) if not d.group(4) or int(d.group(4)) == year]
            labelled = [d for d in dates if prose[max(0, d.start() - 6):d.start()].strip().endswith("Date:")]
            d = (labelled or dates or [None])[0]
            if d:
                day1, day2, mon = int(d.group(1)), d.group(2), FULL[d.group(3)]
                start = dt.date(year, mon, day1)
                end = dt.date(year, mon, int(day2)) if day2 else start + dt.timedelta(days=1)
                last_date = (start, end)
            t = Tables(); t.feed(m.group(0))
            if not t.tables or not t.tables[0]:
                continue
            rows = t.tables[0]
            header = [strip(c[1]) for c in rows[0]]
            if header[:1] != ["Home team"] or "Location" not in header:
                continue
            loc_i, ven_i, sur_i = header.index("Location"), header.index("Venue"), header.index("Surface")
            for r in rows[1:]:
                cells = [strip(c[1]) for c in r]
                if len(cells) <= sur_i:
                    continue
                home = re.sub(r"\s*\[\d+\]$", "", cells[0]); away = re.sub(r"\s*\[\d+\]$", "", cells[2])
                city, venue, surface = cells[loc_i], cells[ven_i], cells[sur_i]
                if not home or not city or not last_date:
                    continue
                surf = next((s for s in ("Hard", "Clay", "Grass", "Carpet") if s in surface), surface or None)
                out.append({
                    "tour": tour, "name": f"{section if section.startswith(cup) else cup + ' ' + section}: {home} v {away}", "city": city,
                    "country": NATION_COUNTRY.get(home, home), "category": "Team", "surface": surf,
                    "start": last_date[0].isoformat(), "end": last_date[1].isoformat(),
                    "prize": None, "grade": None, "draw": None, "venue": venue or None, "page": title.format(y=year),
                })
        print(f"{cup}: {sum(e['name'].startswith(cup) for e in out)} ties", file=sys.stderr)
    json.dump({"season": year, "generated": dt.date.today().isoformat(), "tournaments": out}, sys.stdout, ensure_ascii=False, indent=0)


if __name__ == "__main__":
    main()
