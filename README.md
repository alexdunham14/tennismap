# Tennis Map

Every professional tennis tournament of the season on a map, filterable by
tour, level, surface, and date. City-level, because that is how you plan a
trip, and exact venues are often not even known.

## Definition of done

- A static page: map with a point per city, sized by number of events in the
  selected range, and a plain list by week underneath. Filters for date range,
  men's/women's, level (Grand Slam, 1000, 500, 250, Challenger and WTA 125,
  team events), and surface.
- One season's calendar for ATP, WTA, ATP Challenger, and WTA 125 loaded from
  Wikipedia's yearly tour pages by a seed script, run once a year.
- Cities geocoded once into `cities.json`, hand-corrected where needed.

Out of scope: ITF World Tennis Tour (a thousand events, changes weekly),
draws, results, players.

## Refresh for a new season

```
./seed/wikipedia.py 2027 > tournaments.json
./scripts/geocode.py
git commit -am "2027 calendar" && git push
```

The seed parses the schedule tables of the `<year> ATP Tour`, `<year> WTA
Tour`, `<year> ATP Challenger Tour`, and `<year> WTA 125 tournaments` pages.
Wikipedia reorganises those tables occasionally; if the parse finds fewer
events than expected it says so and exits without writing.

## Layout

- `tournaments.json`: the data, one object per event.
- `cities.json`: coordinates per "City, Country" key. Hand fixes stick.
- `index.html`, `styles.css`, `app.js`: the site. Leaflet from cdnjs, tiles
  from OpenStreetMap. No build step.
- `seed/wikipedia.py`, `scripts/geocode.py`: the two scripts. Standard library.

## Hosting

Cloudflare Workers static assets (`wrangler.jsonc`), deployed on push by
GitHub Actions with the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
repository secrets.
