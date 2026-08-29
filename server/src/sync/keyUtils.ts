export function normalizeKeyPart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function stopSourceKey(name: string, lat: number, lng: number): string {
  return `timbus:${normalizeKeyPart(name)}:${lat.toFixed(6)}:${lng.toFixed(6)}`
}

export function isValidStopSourceKey(
  sourceKey: string,
  name: string,
  lat: number,
  lng: number,
): boolean {
  return (
    sourceKey === stopSourceKey(name, lat, lng) ||
    /^busmap:hn:station:\d+$/.test(sourceKey)
  )
}

export function routeCodeFromName(name: string): string {
  const bracketedCode = name.match(/\[([^\]]+)\]/)?.[1]?.trim()
  if (bracketedCode) return bracketedCode.toUpperCase()
  const routePrefix = name.match(/^Tuy\u1ebfn\s+([A-Za-z0-9-]+)/i)?.[1]
  return (routePrefix ?? normalizeKeyPart(name)).toUpperCase()
}
