import { createDecipheriv } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const API = 'https://api-web.busmap.vn';
const outputDir = new URL('./raw/', import.meta.url);

async function getJson(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${path}`);
  }
  return response.json();
}

function decryptPayload(payload, key) {
  const encrypted = Buffer.from(payload, 'hex');
  const iv = encrypted.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  const plaintext = decipher.update(encrypted.subarray(16), undefined, 'utf8')
    + decipher.final('utf8');

  try {
    return JSON.parse(plaintext);
  } catch {
    return plaintext;
  }
}

async function getDecrypted(path, key) {
  return decryptPayload(await getJson(path), key);
}

const command = process.argv[2] ?? 'regions';
const key = await getJson('/web/public/auth/decrypt_key');

if (command === 'regions') {
  console.log(JSON.stringify(await getDecrypted('/web/public/region/list', key), null, 2));
} else if (command === 'routes') {
  const regionCode = process.argv[3] ?? 'hn';
  console.log(JSON.stringify(
    await getDecrypted(`/web/public/route/list?regionCode=${encodeURIComponent(regionCode)}`, key),
    null,
    2,
  ));
} else if (command === 'detail') {
  const routeId = process.argv[3];
  const regionCode = process.argv[4] ?? 'hn';
  if (!routeId) throw new Error('Usage: node busmap-client.mjs detail <routeId> [regionCode]');
  console.log(JSON.stringify(
    await getDecrypted(
      `/web/public/route/detail?routeId=${encodeURIComponent(routeId)}&regionCode=${encodeURIComponent(regionCode)}`,
      key,
    ),
    null,
    2,
  ));
} else if (command === 'snapshot') {
  const regionCode = process.argv[3] ?? 'hn';
  const wantedCodes = new Set([
    '01', '02TC', '07', '08A', '08B', '09A', '09B', '11', '16', '17', '22A',
    '22B', '26', '28', '31', '32', '32TC', '33', '34', '36', '38',
  ]);
  await mkdir(outputDir, { recursive: true });
  const routes = await getDecrypted(
    `/web/public/route/list?regionCode=${encodeURIComponent(regionCode)}`,
    key,
  );
  await writeFile(new URL(`routes-${regionCode}.json`, outputDir), `${JSON.stringify(routes, null, 2)}\n`);
  const selectedRoutes = routes.filter((route) => wantedCodes.has(route.routeNo.toUpperCase()));
  const details = await Promise.all(selectedRoutes.map(async (route) => ({
    route,
    detail: await getDecrypted(
      `/web/public/route/detail?routeId=${encodeURIComponent(route.routeId)}&regionCode=${encodeURIComponent(regionCode)}`,
      key,
    ),
  })));
  for (const { route, detail } of details) {
    await writeFile(
      new URL(`route-${route.routeNo.toUpperCase()}.json`, outputDir),
      `${JSON.stringify(detail, null, 2)}\n`,
    );
  }
  const missingCodes = [...wantedCodes].filter(
    (code) => !selectedRoutes.some((route) => route.routeNo.toUpperCase() === code),
  );
  console.log(JSON.stringify({
    regionCode,
    catalogRoutes: routes.length,
    matchedRoutes: selectedRoutes.length,
    missingCodes,
    details: details.map(({ route, detail }) => ({
      code: route.routeNo,
      routeId: route.routeId,
      stations: detail.stations?.length ?? 0,
    })),
  }, null, 2));
} else {
  throw new Error(`Unknown command: ${command}`);
}
