(async function () {
  const $ = id => document.getElementById(id);
  const [data, cities] = await Promise.all([
    fetch("tournaments.json", { cache: "no-cache" }).then(r => r.json()),
    fetch("cities.json", { cache: "no-cache" }).then(r => r.json()),
  ]);
  const events = data.tournaments;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const local = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const fmt = s => local(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const key = e => `${e.city}, ${e.country}`;
  const CATS = ["Grand Slam", "1000", "500", "250", "Challenger/125", "Finals", "Team", "Olympics", "Other"];
  const COLOR = { "Grand Slam": "#8a3b12", "1000": "#c0562a", "500": "#e0864f", "250": "#efb08a", "Challenger/125": "#b9b0a5", Finals: "#8a3b12", Team: "#5b7a8a", Olympics: "#5b7a8a", Other: "#b9b0a5" };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const p = new URLSearchParams(location.search);
  const upcoming = events.some(e => local(e.end) >= today);
  $("from").value = p.get("from") || (upcoming ? day(today) : events[0].start);
  $("to").value = p.get("to") || (upcoming ? day(new Date(today.getTime() + 56 * 864e5)) : events[events.length - 1].end);
  for (const c of CATS) if (events.some(e => e.category === c)) $("cat").insertAdjacentHTML("beforeend", `<option value="${esc(c)}">${esc(c)}</option>`);
  for (const s of [...new Set(events.map(e => e.surface))].sort()) $("surface").insertAdjacentHTML("beforeend", `<option value="${esc(s)}">${esc(s)}</option>`);
  if (p.get("cat")) $("cat").value = p.get("cat");
  if (p.get("surface")) $("surface").value = p.get("surface");
  if (p.has("tour")) for (const cb of document.querySelectorAll("input[name=tour]")) cb.checked = p.getAll("tour").includes(cb.value);

  const map = L.map("map", { scrollWheelZoom: false, worldCopyJump: true }).setView([30, 10], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  const layer = L.layerGroup().addTo(map);

  function selected() {
    const from = $("from").value, to = $("to").value, cat = $("cat").value, surface = $("surface").value;
    const tours = [...document.querySelectorAll("input[name=tour]:checked")].map(cb => cb.value);
    // an event is in range if any of its days fall inside [from, to]
    return events.filter(e => (!from || e.end >= from) && (!to || e.start <= to) && tours.includes(e.tour) && (!cat || e.category === cat) && (!surface || e.surface === surface));
  }

  function render() {
    const shown = selected();
    const u = new URL(location.href);
    u.searchParams.set("from", $("from").value); u.searchParams.set("to", $("to").value);
    for (const k of ["cat", "surface"]) $(k).value ? u.searchParams.set(k, $(k).value) : u.searchParams.delete(k);
    u.searchParams.delete("tour");
    const tours = [...document.querySelectorAll("input[name=tour]:checked")].map(cb => cb.value);
    if (tours.length !== 2) for (const t of tours) u.searchParams.append("tour", t);
    history.replaceState(null, "", u);

    layer.clearLayers();
    const byCity = new Map();
    for (const e of shown) { const k = key(e); if (!byCity.has(k)) byCity.set(k, []); byCity.get(k).push(e); }
    let unplaced = 0;
    for (const [k, list] of byCity) {
      const c = cities[k];
      if (!c || c.lat == null) { unplaced += list.length; continue; }
      const top = CATS.find(cat => list.some(e => e.category === cat)) || "Other";
      L.circleMarker([c.lat, c.lon], { radius: 5 + Math.min(list.length, 6) * 1.5, color: "#333", weight: 1, fillColor: COLOR[top], fillOpacity: .85 }).addTo(layer)
        .bindPopup(`<div class="pop"><b>${esc(k)}</b>${list.map(e => `${fmt(e.start)}–${fmt(e.end)} · ${esc(e.name)} <span class="tag">${esc(e.tour)} ${esc(e.category)}, ${esc(e.surface)}</span>`).join("<br>")}</div>`, { maxWidth: 340 });
    }

    const byWeek = new Map();
    for (const e of shown) { if (!byWeek.has(e.start)) byWeek.set(e.start, []); byWeek.get(e.start).push(e); }
    $("list").innerHTML = shown.length ? [...byWeek.keys()].sort().map(w => `
      <h2>Week of ${fmt(w)}</h2>
      <table>${byWeek.get(w).sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category) || a.name.localeCompare(b.name)).map(e => `
        <tr><td class="when">${fmt(e.start)}–${fmt(e.end)}</td>
            <td>${esc(e.name)} <span class="tag">${esc(e.tour)} ${esc(e.category)}, ${esc(e.surface)}${e.prize ? ", " + esc(e.prize) : ""}</span></td>
            <td class="city">${cities[key(e)] && cities[key(e)].lat != null ? `<a href="#map" data-city="${esc(key(e))}">${esc(key(e))}</a>` : esc(key(e))}</td></tr>`).join("")}
      </table>`).join("") : '<p class="none">No tournaments in this range.</p>';
    $("count").textContent = `${shown.length} tournament${shown.length === 1 ? "" : "s"} in ${byCity.size} cit${byCity.size === 1 ? "y" : "ies"}${unplaced ? ` (${unplaced} not yet on the map)` : ""}.`;
  }

  $("list").addEventListener("click", ev => {
    const a = ev.target.closest("a[data-city]"); if (!a) return;
    const c = cities[a.dataset.city]; map.setView([c.lat, c.lon], 6);
    layer.eachLayer(m => { const ll = m.getLatLng(); if (ll.lat === c.lat && ll.lng === c.lon) m.openPopup(); });
  });
  for (const el of document.querySelectorAll("#f input, #f select")) el.addEventListener("change", render);
  $("meta").textContent = `${data.season} season, ${events.length} tournaments, from Wikipedia's ${data.season} ATP Tour, WTA Tour, ATP Challenger Tour, and WTA 125 pages, read on ${data.generated}.`;
  render();
})();
