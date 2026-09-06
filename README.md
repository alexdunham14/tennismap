# Tennis Map

Every professional tennis tournament of the season on a map, from the Grand
Slams down to the ITF World Tennis Tour, plus Davis Cup and Billie Jean King
Cup ties. Filterable by tour, level, surface, and date. City-level, because
that is how you plan a trip, and exact venues are often not even known.

## Definition of done

- A static page: map with a point per city, sized by number of events in the
  selected range, and a plain list by week underneath. Filters for date range,
  men's/women's, level (Grand Slam, 1000, 500, 250, Challenger and WTA 125,
  ITF, team events), and surface.
- Three tiers of data, each with its own seed script:
  1. ATP, WTA, ATP Challenger, WTA 125: Wikipedia's yearly tour pages, once a season.
  2. ITF World Tennis Tour, men's and women's: about 1,200 events a year,
     published a few months ahead and changed weekly, so refreshed monthly.
  3. Davis Cup and Billie Jean King Cup ties: dated, with host city, refreshed monthly.
- A monthly workflow that reruns the ITF and cup seeds, geocodes new cities,
  commits, and deploys. If a source's format changes, that seed fails loudly and
  the site keeps the last good data.
- Cities geocoded once into `cities.json`, hand-corrected where needed.

Out of scope: draws, results, players, junior and wheelchair circuits.

## Refresh

```
./refresh          # this season
./refresh 2027     # a new season, once its Wikipedia pages exist
```

`refresh` runs both seeds, merges them into `tournaments.json`, and geocodes
any city not yet in `cities.json`. A GitHub Actions workflow runs it on the
first of every month and deploys. `seed/wikipedia.py` parses the schedule
tables of the `<year> ATP Tour`, `WTA Tour`, `ATP Challenger Tour`, `WTA 125
tournaments`, and the quarterly `ITF Men's/Women's World Tennis Tour` pages;
`seed/cups.py` parses the tie tables of the `<year> Davis Cup` and `Billie
Jean King Cup` pages. Wikipedia reorganises tables occasionally; if a parse
finds fewer events than expected it says so and exits without writing.

The official ITF, Davis Cup, and Billie Jean King Cup sites were checked and
rejected as sources: itftennis.com sits behind bot protection that blocks
plain HTTP clients, and the cup sites render their draws client-side with no
data in the page. Wikipedia's tables are maintained within days of the
official calendars and are parseable with the standard library.

## Cancellations

Tournaments get announced and then cancelled, and the official sites are slow
to say so: the ATP's page for the 2026 Durham Challenger still presented it as
an active event months after it was dropped. Two signals catch this:

1. **Wikipedia's "Cancelled tournaments" section.** The yearly Challenger page
   has one ("The following tournaments were formally announced by the ATP
   before being cancelled"). The seed reads any table under a heading
   containing "Cancel" and marks those events `cancelled`, which the site
   hides and names in its footer line. The ATP, WTA, WTA 125, and ITF pages
   had no such section in 2026; the seed handles one if it appears.
2. **A past event with no champion recorded.** The seed records `played` from
   the Champions cell. `./scripts/suspects.py` lists events more than two
   weeks past with no result, which is either a cancellation or Wikipedia
   lagging. Those candidates need a check against news or the tournament's
   own page; verdicts go in `cancellations.json` as
   `{"name", "start", "status", "source", "note"}`: `refresh` applies the
   cancelled ones, and any entry, including verified `played`, stops the
   sweep from raising that event again.

A third source, found while verifying Durham: the ATP publishes dated
calendar PDFs (`atptour.com/-/media/files/calendar-pdfs/<year>/...`) whose
Challenger edition marks weeks "Cancelled" and "Added". The 18 June 2026
revision shows Durham cancelled and Plovdiv added in its place, while the
February revision still listed Durham. That is first-party and readable with
`pdftotext`, so it is the natural next automation if the sweep keeps finding
Challenger changes. The first sweep (September 2026) checked eleven suspects:
three real cancellations (Durham, and the M25 and W15 Antalya weeks of 19
January, lost to weather), eight Wikipedia lag or walkover formatting.

Run the sweep after each monthly refresh:

```
./scripts/suspects.py > seed/out/suspects.json   # then verify each, by hand or with an agent
```

## Layout

- `tournaments.json`: the data, one object per event.
- `cities.json`: coordinates per "City, Country" key. Hand fixes stick.
- `index.html`, `styles.css`, `app.js`: the site. Leaflet from cdnjs, tiles
  from OpenStreetMap. No build step.
- `seed/wikipedia.py`, `seed/cups.py`, `scripts/geocode.py`, `refresh`: the scripts. Standard library.

## Hosting

Cloudflare Workers static assets (`wrangler.jsonc`), deployed on push by
GitHub Actions with the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
repository secrets.
