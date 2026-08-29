import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const rawDir = path.join(here, 'raw');
const sourcePath = path.join(root, 'server', 'data', 'transit-data.json');
const geometryPath = path.join(root, 'server', 'data', 'route-geometries.json');
const timBusDir = path.join(
  root,
  '.undo',
  '20260817-rollback-preserved',
  'research',
  'hanoi-bus-stops',
  'timbus-current',
);
const osmPath = path.join(
  root,
  '.undo',
  '20260817-rollback-preserved',
  'research',
  'hanoi-bus-stops',
  'osm_transitflow_21_routes.json',
);

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));

function haversine(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]);
}

function nearestDistances(from, to) {
  return from.map((point) => Math.min(...to.map((candidate) => haversine(point, candidate))));
}

function mostFrequent(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean).map((value) => value.trim())) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? '';
}

function pathCoordinates(value, from, to) {
  const coordinates = String(value ?? '')
    .trim()
    .split(/\s+/)
    .map((point) => point.split(',').map(Number))
    .filter(([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng))
    .map(([lng, lat]) => [lat, lng]);
  if (coordinates.length < 2) return [[from.lat, from.lng], [to.lat, to.lng]];

  const forward = haversine(from, { lat: coordinates[0][0], lng: coordinates[0][1] })
    + haversine(to, { lat: coordinates.at(-1)[0], lng: coordinates.at(-1)[1] });
  const reverse = haversine(from, { lat: coordinates.at(-1)[0], lng: coordinates.at(-1)[1] })
    + haversine(to, { lat: coordinates[0][0], lng: coordinates[0][1] });
  if (reverse < forward) coordinates.reverse();
  return coordinates;
}

const source = await readJson(sourcePath);
const routeDetails = new Map();
const selectedByCode = new Map();

for (const route of source.routes) {
  const detail = await readJson(path.join(rawDir, `route-${route.code}.json`));
  routeDetails.set(route.code, detail);
  const directions = Map.groupBy(detail.stations, (stop) => stop.stationDirection);
  const candidates = [...directions.entries()].map(([direction, stops]) => ({
    direction,
    stops: stops.sort((a, b) => a.stationOrder - b.stationOrder),
  }));
  const scored = candidates.map((candidate) => ({
    ...candidate,
    endpointDistance: haversine(route.stops[0], candidate.stops[0])
      + haversine(route.stops.at(-1), candidate.stops.at(-1)),
  })).sort((a, b) => a.endpointDistance - b.endpointDistance);
  const selected = scored[0];
  if (selected.direction !== 1) {
    throw new Error(`Unexpected BusMap direction for ${route.code}: ${selected.direction}`);
  }
  selectedByCode.set(route.code, { selected, alternatives: scored.slice(1) });
}

const occurrencesByStationId = new Map();
for (const { selected } of selectedByCode.values()) {
  for (const stop of selected.stops) {
    const occurrences = occurrencesByStationId.get(stop.stationId) ?? [];
    occurrences.push(stop);
    occurrencesByStationId.set(stop.stationId, occurrences);
  }
}

const canonicalStops = new Map();
const variantStations = [];
for (const [stationId, occurrences] of occurrencesByStationId) {
  const anchor = occurrences[0];
  const maxCoordinateDelta = Math.max(...occurrences.map((stop) => haversine(anchor, stop)));
  if (maxCoordinateDelta > 5) {
    throw new Error(`BusMap station ${stationId} has conflicting coordinates (${maxCoordinateDelta}m)`);
  }
  const names = [...new Set(occurrences.map((stop) => stop.stationName?.trim()).filter(Boolean))];
  const addresses = [...new Set(occurrences.map((stop) => stop.stationAddress?.trim()).filter(Boolean))];
  if (names.length > 1 || addresses.length > 1) {
    variantStations.push({ stationId, names, addresses, maxCoordinateDelta });
  }
  const name = mostFrequent(occurrences.map((stop) => stop.stationName));
  const address = mostFrequent(occurrences.map((stop) => stop.stationAddress)) || name;
  canonicalStops.set(stationId, {
    sourceKey: `busmap:hn:station:${stationId}`,
    name,
    address,
    lat: anchor.lat,
    lng: anchor.lng,
  });
}

const osm = await readJson(osmPath);
const osmNodes = new Map(
  osm.elements
    .filter((element) => element.type === 'node' && element.lat !== undefined && element.lon !== undefined)
    .map((element) => [element.id, { lat: element.lat, lng: element.lon }]),
);
const osmPlatformsByCode = new Map();
for (const relation of osm.elements.filter((element) => element.type === 'relation')) {
  const code = relation.tags?.ref?.toUpperCase();
  if (!code || !selectedByCode.has(code)) continue;
  const platforms = relation.members
    ?.filter((member) => member.type === 'node' && member.role.startsWith('platform'))
    .map((member) => osmNodes.get(member.ref))
    .filter(Boolean) ?? [];
  osmPlatformsByCode.set(code, [...(osmPlatformsByCode.get(code) ?? []), ...platforms]);
}

const routeReports = [];
const nextRoutes = [];
const geometryRoutes = [];
for (const route of source.routes) {
  const { selected, alternatives } = selectedByCode.get(route.code);
  const stops = selected.stops.map((stop) => canonicalStops.get(stop.stationId));
  const oldToBusMap = nearestDistances(route.stops, stops);
  const osmPlatforms = osmPlatformsByCode.get(route.code) ?? [];
  const busMapToOsm = osmPlatforms.length ? nearestDistances(stops, osmPlatforms) : [];

  let timBusToBusMap = [];
  try {
    const timBus = await readJson(path.join(timBusDir, `${route.code}.json`));
    const timBusStops = timBus.dt.Go.Station.map((stop) => ({
      lat: stop.Geo.Lat,
      lng: stop.Geo.Lng,
    }));
    timBusToBusMap = nearestDistances(timBusStops, stops);
  } catch {
    // 02TC and 32TC are absent from the current TimBus catalog.
  }

  routeReports.push({
    code: route.code,
    busMapRouteId: routeDetails.get(route.code).routeId,
    selectedDirection: selected.direction,
    selectedFirstStop: stops[0].name,
    selectedLastStop: stops.at(-1).name,
    oldStops: route.stops.length,
    busMapStops: stops.length,
    reverseDirectionStops: alternatives[0]?.stops.length ?? 0,
    oldNearestBusMap: {
      within100m: oldToBusMap.filter((distance) => distance <= 100).length,
      over500m: oldToBusMap.filter((distance) => distance > 500).length,
      medianMeters: percentile(oldToBusMap, 0.5),
      p95Meters: percentile(oldToBusMap, 0.95),
    },
    timBusNearestBusMap: {
      comparedStops: timBusToBusMap.length,
      within100m: timBusToBusMap.filter((distance) => distance <= 100).length,
      medianMeters: percentile(timBusToBusMap, 0.5),
      p95Meters: percentile(timBusToBusMap, 0.95),
    },
    busMapNearestOsm: {
      comparedStops: busMapToOsm.length,
      within100m: busMapToOsm.filter((distance) => distance <= 100).length,
      medianMeters: percentile(busMapToOsm, 0.5),
      p95Meters: percentile(busMapToOsm, 0.95),
    },
  });
  nextRoutes.push({ ...route, stops });
  geometryRoutes.push({
    code: route.code,
    segments: selected.stops.slice(0, -1).map((from, index) => {
      const to = selected.stops[index + 1];
      return {
        fromSourceKey: `busmap:hn:station:${from.stationId}`,
        toSourceKey: `busmap:hn:station:${to.stationId}`,
        coordinates: pathCoordinates(to.pathPoints, from, to),
      };
    }),
  });
}

const candidate = {
  ...source,
  exportedAt: new Date().toISOString(),
  routes: nextRoutes,
};
const report = {
  generatedAt: new Date().toISOString(),
  mode: 'dry-run; canonical source and database unchanged',
  source: 'BusMap public web API, Hanoi region',
  sourceEndpoint: 'https://api-web.busmap.vn/web/public/route/detail',
  directionPolicy: 'Keep each TransitFlow route orientation; select the BusMap direction whose endpoints are nearest to the existing named endpoints.',
  routesKept: source.routes.length,
  matchedBusMapRoutes: routeReports.length,
  selectedRouteStops: nextRoutes.reduce((sum, route) => sum + route.stops.length, 0),
  uniquePhysicalStops: canonicalStops.size,
  stationsWithNamingVariants: variantStations.length,
  variantStations,
  routes: routeReports,
};

await writeFile(path.join(here, 'candidate-transit-data.json'), `${JSON.stringify(candidate, null, 2)}\n`);
await writeFile(path.join(here, 'comparison-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(geometryPath, `${JSON.stringify({
  version: 1,
  source: 'BusMap Hanoi public route detail pathPoints, stationDirection=1',
  generatedAt: new Date().toISOString(),
  routes: geometryRoutes,
}, null, 2)}\n`);

const rows = routeReports.map((route) =>
  `| ${route.code} | ${route.oldStops} | ${route.busMapStops} | ${route.selectedFirstStop} → ${route.selectedLastStop} | ${route.oldNearestBusMap.within100m}/${route.oldStops} | ${route.oldNearestBusMap.medianMeters} | ${route.timBusNearestBusMap.within100m}/${route.timBusNearestBusMap.comparedStops} | ${route.busMapNearestOsm.within100m}/${route.busMapNearestOsm.comparedStops} |`,
);
const markdown = `# Đối chiếu stop vật lý cho 21 tuyến TransitFlow\n\n` +
  `Trạng thái: **dry-run**. Chưa thay đổi \`server/data/transit-data.json\` hoặc MongoDB.\n\n` +
  `- Giữ nguyên đủ ${source.routes.length} tuyến và toàn bộ metadata tuyến.\n` +
  `- Khớp đủ ${routeReports.length}/${source.routes.length} mã tuyến với BusMap Hà Nội, gồm cả \`02TC\` và \`32TC\`.\n` +
  `- Chọn đúng chiều hiện có của TransitFlow (BusMap \`stationDirection=1\` cho cả 21 tuyến).\n` +
  `- Bộ ứng viên có ${report.selectedRouteStops} lượt ghé trạm, tương ứng ${report.uniquePhysicalStops} stop vật lý duy nhất theo BusMap \`stationId\`.\n` +
  `- Đối chiếu phụ với TimBus hiện hành cho 19 tuyến và OSM cho 19 tuyến; hai tuyến TC không có trong hai nguồn phụ hiện hành.\n\n` +
  `| Tuyến | Stop cũ | Stop BusMap | Chiều được chọn | Stop cũ gần BusMap ≤100m | Trung vị lệch cũ (m) | TimBus gần BusMap ≤100m | BusMap gần OSM ≤100m |\n` +
  `|---|---:|---:|---|---:|---:|---:|---:|\n${rows.join('\n')}\n`;
await writeFile(path.join(here, 'comparison-report.md'), markdown, 'utf8');

console.log(JSON.stringify({
  routes: report.routesKept,
  routeStops: report.selectedRouteStops,
  uniquePhysicalStops: report.uniquePhysicalStops,
  stationVariants: report.stationsWithNamingVariants,
}, null, 2));
