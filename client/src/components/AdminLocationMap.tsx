import { useEffect } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'

interface Props {
  lat: number
  lng: number
  onChange: (lat: number, lng: number) => void
}

function MapController({ lat, lng, onChange }: Props) {
  const map = useMap()
  useMapEvents({
    click(event) {
      onChange(
        Number(event.latlng.lat.toFixed(6)),
        Number(event.latlng.lng.toFixed(6)),
      )
    },
  })

  useEffect(() => {
    map.setView([lat, lng], Math.max(map.getZoom(), 16), { animate: true })
  }, [lat, lng, map])

  return null
}

export default function AdminLocationMap({ lat, lng, onChange }: Props) {
  return (
    <div className="h-72 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <MapContainer center={[lat, lng]} zoom={16} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="/map-tiles/{z}/{x}/{y}.png?source=osm-v1"
        />
        <CircleMarker
          center={[lat, lng]}
          radius={10}
          pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
        />
        <MapController lat={lat} lng={lng} onChange={onChange} />
      </MapContainer>
    </div>
  )
}
