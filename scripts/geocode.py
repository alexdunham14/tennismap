#!/usr/bin/env python3
"""Geocode every "City, Country" in tournaments.json once, into cities.json.
Nominatim (OpenStreetMap), one request per second. Never overwrites a city that already
has coordinates, so hand fixes in cities.json stick. Saves after every city."""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

UA = "tennismap/1.0 (github.com/alexdunham14/tennismap)"
ALIASES = {"New York City": "New York", "Hong Kong SAR": "Hong Kong"}


def nominatim(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "jsonv2", "limit": 1})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.load(r)
    time.sleep(1.1)
    return res[0] if res else None


def main():
    events = json.load(open("tournaments.json"))["tournaments"]
    cities = json.load(open("cities.json")) if os.path.exists("cities.json") else {}
    keys = sorted({f"{e['city']}, {e['country']}" for e in events})
    for k in keys:
        c = cities.setdefault(k, {})
        if c.get("lat") is not None:
            continue
        city, _, country = k.partition(", ")
        city = ALIASES.get(city, city).split("/")[0].strip()   # "Perth/Sydney" -> Perth
        hit = None
        for q in (f"{city}, {country}", city):
            try:
                hit = nominatim(q)
            except Exception as ex:  # noqa: BLE001
                print("error", q, ex, file=sys.stderr); continue
            if hit:
                break
        if hit:
            c.update({"lat": round(float(hit["lat"]), 4), "lon": round(float(hit["lon"]), 4), "matched": hit.get("display_name", "")[:100]})
            print("ok  ", k, "->", hit.get("display_name", "")[:70], flush=True)
        else:
            c.update({"lat": None, "lon": None})
            print("MISS", k, flush=True)
        json.dump(cities, open("cities.json", "w"), ensure_ascii=False, indent=1)
    missing = [k for k, c in cities.items() if c.get("lat") is None]
    print(f"{len(cities)} cities, {len(missing)} missing: {missing}")


if __name__ == "__main__":
    main()
