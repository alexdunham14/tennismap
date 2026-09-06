#!/usr/bin/env python3
"""Build tournaments.json for one season from Wikipedia's yearly tour pages.

    ./seed/wikipedia.py 2026 > tournaments.json

Each page's monthly schedule tables have a Week column (the Monday, with a rowspan
covering that week's events) and a Tournament cell whose lines are:
name / "City, Country" / category / "Surface – $prize – draws" / "Singles – Doubles".
"""
import datetime as dt
import gzip
import html
import json
import re
import sys
import urllib.request
from html.parser import HTMLParser

UA = "tennismap/1.0 (github.com/alexdunham14/tennismap)"
PAGES = [  # (tour, page title, minimum events expected; 0 = page may not exist yet)
    ("ATP", "{y}_ATP_Tour", 60),
    ("WTA", "{y}_WTA_Tour", 50),
    ("ATP", "{y}_ATP_Challenger_Tour", 120),
    ("WTA", "{y}_WTA_125_tournaments", 20),
]
# The ITF World Tennis Tour is split into quarterly sub-articles that appear as the year goes on.
QUARTERS = ["January%E2%80%93March", "April%E2%80%93June", "July%E2%80%93September", "October%E2%80%93December"]
PAGES += [("ATP", "{y}_ITF_Men%27s_World_Tennis_Tour_(" + q + ")", 0) for q in QUARTERS]
PAGES += [("WTA", "{y}_ITF_Women%27s_World_Tennis_Tour_(" + q + ")", 0) for q in QUARTERS]
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def week_date(text, year):
    """The Monday a Week cell names: '5 Jan', 'Jan 5', 'January 5'. Two-week events list both
    Mondays; take the first. A December start belongs to the previous calendar year."""
    found = re.findall(r"(\d{1,2}) ([A-Z][a-z]{2})[a-z]*|([A-Z][a-z]{2})[a-z]* (\d{1,2})", text)
    if not found:
        return None
    d1, m1, m2, d2 = found[0]
    day, mon = (int(d1), m1) if d1 else (int(d2), m2)
    if mon not in MONTHS:
        return None
    return dt.date(year - 1 if mon == "Dec" else year, MONTHS[mon], day)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", errors="replace")


class Tables(HTMLParser):
    """Collects every <table> as rows of (rowspan, text) cells, keeping <br> as newlines."""
    def __init__(self):
        super().__init__(); self.tables = []; self.row = None; self.cell = None; self.depth = 0; self.attr = {}
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table": self.depth += 1; self.tables.append([])
        elif tag == "tr" and self.depth: self.row = []
        elif tag in ("td", "th") and self.row is not None: self.cell = []; self.attr = a
        elif tag == "br" and self.cell is not None: self.cell.append("\n")
    def handle_endtag(self, tag):
        if tag == "table": self.depth -= 1
        elif tag == "tr" and self.row is not None: self.tables[-1].append(self.row); self.row = None
        elif tag in ("td", "th") and self.cell is not None:
            self.row.append((int(self.attr.get("rowspan") or 1), html.unescape("".join(self.cell)))); self.cell = None
    def handle_data(self, d):
        if self.cell is not None: self.cell.append(d)


def clean(s):
    s = re.sub(r"\[[a-z0-9]+\]", "", s)         # footnotes like [3] or [a]
    return [re.sub(r"\s+", " ", l).strip() for l in s.split("\n") if l.strip()]


def parse_page(tour, title, year):
    page = fetch(f"https://en.wikipedia.org/wiki/{title}")
    p = Tables(); p.feed(page)
    out = []
    for table in p.tables:
        if not table or not any("Tournament" in c[1] for c in table[0]):
            continue
        header = [re.sub(r"\s+", " ", c[1]).strip() for c in table[0]]
        if "Week" not in header[0] and "Date" not in header[0]:
            continue
        week = None
        for row in table[1:]:
            cells = [c for c in row]
            if not cells:
                continue
            first = " ".join(clean(cells[0][1]))
            wd = week_date(first, year) if len(first) <= 24 else None
            if wd and len(cells) > 1 and len(clean(cells[1][1])) >= 2:
                week = wd
                tcell = cells[1][1]
            elif wd and len(cells) == 1:
                week = wd
                continue
            else:
                # continuation row (doubles line) or a row whose first cell is the tournament
                if len(clean(cells[0][1])) >= 3 and re.search(r"(Hard|Clay|Grass|Carpet)", cells[0][1]) and week:
                    tcell = cells[0][1]
                else:
                    continue
            lines = clean(tcell)
            if len(lines) < 3:
                continue
            # The place line is the first "City, Country" line; a long name can spill onto two lines.
            # ITF rows have no name line at all: the place comes first and the grade (M25, W75) names the event.
            pi = next((i for i, l in enumerate(lines) if re.match(r"^[^,$€£]+, [A-Z]", l) and not re.search(r"\d{3},\d{3}", l)), 1)
            name = " ".join(lines[:pi])
            place = lines[pi]
            rest = " ".join(lines[pi + 1:])
            grade = re.search(r"\b([MW]\d{2,3})\b", rest)
            if not name and grade:
                name = f"{grade.group(1)} {place.split(',')[0]}"
            surface = next((s for s in ("Hard", "Clay", "Grass", "Carpet") if re.search(r"\b" + s + r"\b", rest)), None)
            if not surface:
                continue
            cat = None
            for pat, label in [
                (r"Grand Slam", "Grand Slam"), (r"ATP Finals|WTA Finals|Next Gen", "Finals"),
                (r"United Cup|Davis Cup|Billie Jean King Cup|Laver Cup|Hopman", "Team"),
                (r"Masters 1000|ATP 1000|WTA 1000|Masters", "1000"), (r"ATP 500|WTA 500", "500"), (r"ATP 250|WTA 250", "250"),
                (r"WTA 125|Challenger", "Challenger/125"), (r"Olympic", "Olympics"),
                (r"\b[MW]\d{2,3}\b", "ITF"),
            ]:
                if re.search(pat, rest) or re.search(pat, name):
                    cat = label; break
            if cat is None:
                cat = "Challenger/125" if "Challenger" in title or "125" in title else "Other"
            if cat == "Team" and re.search(r"Davis Cup|Billie Jean King Cup", name + rest) and not re.search(r"Finals|Final 8", name + rest):
                continue  # qualifying ties are many, home-and-away, and rarely dated by week; keep the Finals only
            draw = re.search(r"(\d+)S", rest)
            days = 13 if cat == "Grand Slam" else (11 if cat == "1000" and draw and int(draw.group(1)) >= 96 else 6)
            prize = re.search(r"(?:\$|€|£|A\$)[\d,]+", rest)
            city, _, country = place.partition(", ")
            if not country:
                country = {"Hong Kong SAR": "Hong Kong", "Hong Kong": "Hong Kong", "Macau": "Macau", "Singapore": "Singapore"}.get(city, "")
                city = city.replace(" SAR", "")
            out.append({
                "tour": tour, "name": name, "city": city, "country": country, "category": cat, "surface": surface,
                "start": week.isoformat(), "end": (week + dt.timedelta(days=days)).isoformat(),
                "prize": prize.group(0) if prize else None, "grade": grade.group(1) if grade else None,
                "draw": draw.group(1) + " singles" if draw else None,
                "page": title,
            })
    return out


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else dt.date.today().year
    events = []
    for tour, title, minimum in PAGES:
        title = title.format(y=year)
        try:
            got = parse_page(tour, title, year)
        except Exception as ex:  # noqa: BLE001
            if minimum == 0:
                print(f"{title}: not available yet ({ex})", file=sys.stderr)
                continue
            sys.exit(f"{title}: failed ({ex})")
        print(f"{title}: {len(got)} events", file=sys.stderr)
        if len(got) < minimum:
            sys.exit(f"{title}: only {len(got)} events parsed, expected at least {minimum}; page layout may have changed")
        events += got
    seen = set()
    events = [e for e in events if not ((e["tour"], e["name"], e["start"]) in seen or seen.add((e["tour"], e["name"], e["start"])))]
    events.sort(key=lambda e: (e["start"], e["tour"], e["name"]))
    json.dump({"season": year, "generated": dt.date.today().isoformat(), "tournaments": events}, sys.stdout, ensure_ascii=False, indent=0)
    print(f"{len(events)} events total", file=sys.stderr)


if __name__ == "__main__":
    main()
