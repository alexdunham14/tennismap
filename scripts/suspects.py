#!/usr/bin/env python3
"""List events that may not have happened: past by more than two weeks, not in a Cancelled
section, and with no champion recorded on Wikipedia. Output is a candidate list for a human
or an agent to verify; confirmed findings go in cancellations.json."""
import datetime as dt
import json
import sys

today = dt.date.today()
cut = (today - dt.timedelta(days=14)).isoformat()
data = json.load(open("tournaments.json"))
known = {(c["name"], c["start"]) for c in json.load(open("cancellations.json"))} if __import__("os").path.exists("cancellations.json") else set()
out = [e for e in data["tournaments"] if not e.get("cancelled") and e.get("played") is False and e["end"] < cut and (e["name"], e["start"]) not in known]
json.dump([{k: e[k] for k in ("tour", "name", "city", "country", "category", "start", "end", "page")} for e in out], sys.stdout, ensure_ascii=False, indent=1)
print(f"\n{len(out)} candidates", file=sys.stderr)
