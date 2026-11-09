import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Activity, ArrowDown, ArrowUp, ChevronRight, CircleGauge, Clock3,
  CloudSun, Compass, Gauge, Globe2, LocateFixed, Map, Menu, Plane,
  RefreshCw, Search, Signal, Wifi, WifiOff, X,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

const formatAltitude = (meters) => meters == null ? '—' : `${Math.round(meters * 3.28084).toLocaleString()} ft`
const formatSpeed = (ms) => ms == null ? '—' : `${Math.round(ms * 3.6)} km/h`
const timeAgo = (unix) => {
  if (!unix) return 'just now'
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - unix))
  return seconds < 5 ? 'just now' : `${seconds}s ago`
}

const distanceKm = (a, b) => {
  const radians = value => value * Math.PI / 180
  const dLat = radians(b.latitude - a.latitude)
  const dLon = radians(b.longitude - a.longitude)
  const lat1 = radians(a.latitude)
  const lat2 = radians(b.latitude)
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

const locationCircle = (location, radiusKm) => {
  const coordinates = []
  const angular = radiusKm / 6371
  const lat = location.latitude * Math.PI / 180
  const lon = location.longitude * Math.PI / 180
  for (let bearing = 0; bearing <= 360; bearing += 6) {
    const angle = bearing * Math.PI / 180
    const pointLat = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(angle))
    const pointLon = lon + Math.atan2(Math.sin(angle) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(pointLat))
    coordinates.push([pointLon * 180 / Math.PI, pointLat * 180 / Math.PI])
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coordinates] } }
}

function Metric({ icon: Icon, label, value, accent }) {
  return <div className="metric">
    <div className={`metric-icon ${accent || ''}`}><Icon size={18} /></div>
    <div><span>{label}</span><strong>{value}</strong></div>
  </div>
}

function WorldMap({ aircraft, selected, onSelect, userLocation, nearbyRadius, following }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const userMarkerRef = useRef(null)
  const previousSelectionRef = useRef(null)

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          openstreetmap: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
          },
        },
        layers: [
          {
            id: 'openstreetmap-basemap',
            type: 'raster',
            source: 'openstreetmap',
            paint: {
              'raster-saturation': -0.72,
              'raster-contrast': 0.28,
              'raster-brightness-min': 0.06,
              'raster-brightness-max': 0.52,
            },
          },
        ],
      },
      center: [18, 24],
      zoom: 1.4,
      minZoom: 1,
      maxZoom: 12,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    markersRef.current.forEach(marker => marker.remove())
    markersRef.current = aircraft
      .filter(item => item.longitude != null && item.latitude != null)
      .map(item => {
        const active = selected?.icao24 === item.icao24
        const marker = document.createElement('button')
        marker.type = 'button'
        marker.className = `flight-marker ${active ? 'active' : ''}`
        marker.title = `${item.callsign} · ${item.origin_country}`
        marker.setAttribute('aria-label', `View flight ${item.callsign}`)
        marker.innerHTML = `<span style="transform:rotate(${item.true_track || 0}deg)">✈</span>${active ? `<b>${item.callsign}</b>` : ''}`
        marker.addEventListener('click', event => { event.stopPropagation(); onSelect(item) })
        return new maplibregl.Marker({ element: marker, anchor: 'center' })
          .setLngLat([item.longitude, item.latitude])
          .addTo(mapRef.current)
      })
  }, [aircraft, selected, onSelect])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !userLocation) return

    if (!userMarkerRef.current) {
      const element = document.createElement('div')
      element.className = 'user-location-marker'
      element.innerHTML = '<span></span>'
      userMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([userLocation.longitude, userLocation.latitude])
        .addTo(map)
    }
    userMarkerRef.current.setLngLat([userLocation.longitude, userLocation.latitude])

    const updateRadius = () => {
      const data = locationCircle(userLocation, nearbyRadius)
      const source = map.getSource('nearby-radius')
      if (source) source.setData(data)
      else {
        map.addSource('nearby-radius', { type: 'geojson', data })
        map.addLayer({ id: 'nearby-radius-fill', type: 'fill', source: 'nearby-radius', paint: { 'fill-color': '#b8f36b', 'fill-opacity': 0.07 } })
        map.addLayer({ id: 'nearby-radius-line', type: 'line', source: 'nearby-radius', paint: { 'line-color': '#b8f36b', 'line-opacity': 0.65, 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      }
    }
    if (map.isStyleLoaded()) updateRadius()
    else map.once('load', updateRadius)
    map.flyTo({ center: [userLocation.longitude, userLocation.latitude], zoom: 6, duration: 1200 })
  }, [userLocation, nearbyRadius])

  useEffect(() => {
    if (!selected || selected.longitude == null || selected.latitude == null || !mapRef.current) return
    const isNewSelection = previousSelectionRef.current !== selected.icao24
    previousSelectionRef.current = selected.icao24
    if (isNewSelection || following) {
      mapRef.current.flyTo({ center: [selected.longitude, selected.latitude], zoom: Math.max(mapRef.current.getZoom(), 4), duration: 1100 })
    }
  }, [selected, following])

  return <div className="world-map">
    <div ref={containerRef} className="map-canvas" aria-label="Interactive global aircraft map" />
    <div className="map-provider"><span className="live-dot" /> INTERACTIVE MAP · OPENSTREETMAP</div>
  </div>
}

function DetailPanel({ aircraft, onClose, following, onFollow }) {
  if (!aircraft) return null
  const climbing = (aircraft.vertical_rate || 0) > .5
  const descending = (aircraft.vertical_rate || 0) < -.5
  return <aside className="detail-panel">
    <div className="detail-head">
      <div><span className="eyebrow">AIRCRAFT DETAIL</span><h2>{aircraft.callsign}</h2></div>
      <button className="icon-btn" onClick={onClose}><X size={18} /></button>
    </div>
    <div className="aircraft-hero">
      <div className="hero-plane" style={{ transform: `rotate(${aircraft.true_track || 0}deg)` }}><Plane size={54} fill="currentColor" /></div>
      <div><strong>{aircraft.origin_country}</strong><span>ICAO24 · {aircraft.icao24.toUpperCase()}</span></div>
    </div>
    <div className="status-row"><span className="live-dot" /> {aircraft.on_ground ? 'On the ground' : 'In flight'} <span>Updated {timeAgo(aircraft.last_contact)}</span></div>
    <div className="detail-grid">
      <div><Gauge size={17} /><span>Ground speed</span><strong>{formatSpeed(aircraft.velocity)}</strong></div>
      <div><ArrowUp size={17} /><span>Altitude</span><strong>{formatAltitude(aircraft.baro_altitude)}</strong></div>
      <div><Compass size={17} /><span>Heading</span><strong>{aircraft.true_track == null ? '—' : `${Math.round(aircraft.true_track)}°`}</strong></div>
      <div>{descending ? <ArrowDown size={17}/> : <ArrowUp size={17}/>}<span>Vertical rate</span><strong>{aircraft.vertical_rate == null ? '—' : `${climbing ? '+' : ''}${aircraft.vertical_rate.toFixed(1)} m/s`}</strong></div>
    </div>
    <div className="position-card">
      <span>LAST POSITION</span>
      <strong>{aircraft.latitude?.toFixed(4)}°, {aircraft.longitude?.toFixed(4)}°</strong>
      <small>Squawk {aircraft.squawk || '—'}{aircraft.distance_km != null ? ` · ${Math.round(aircraft.distance_km)} km from you` : ''}</small>
    </div>
    <button className={`track-button ${following ? 'following' : ''}`} onClick={onFollow}><Activity size={17}/> {following ? 'Following live' : 'Follow aircraft'} <ChevronRight size={17}/></button>
  </aside>
}

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [streamStatus, setStreamStatus] = useState('connecting')
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('')
  const [selected, setSelected] = useState(null)
  const [following, setFollowing] = useState(false)
  const [userLocation, setUserLocation] = useState(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [nearbyOnly, setNearbyOnly] = useState(false)
  const [nearbyRadius, setNearbyRadius] = useState(250)
  const [mobileNav, setMobileNav] = useState(false)
  const locationWatchRef = useRef(null)

  const applySnapshot = useCallback(json => {
    setData(json)
    setSelected(current => current && json.aircraft.find(item => item.icao24 === current.icao24) || current)
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch(`${API}/api/states?limit=1000`)
      if (!response.ok) throw new Error('Could not reach the airspace feed')
      const json = await response.json()
      applySnapshot(json)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [applySnapshot])

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser.')
      return
    }
    if (locationWatchRef.current != null) navigator.geolocation.clearWatch(locationWatchRef.current)
    setLocating(true)
    setLocationError('')
    locationWatchRef.current = navigator.geolocation.watchPosition(
      position => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        })
        setNearbyOnly(true)
        setLocating(false)
      },
      geolocationError => {
        setLocationError(geolocationError.code === 1 ? 'Location permission was denied.' : 'Your location could not be determined.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 },
    )
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let socket
    let reconnectTimer
    let stopped = false
    const connect = () => {
      setStreamStatus('connecting')
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      let url = import.meta.env.VITE_WS_URL
      if (!url) {
        const base = new URL(API || window.location.origin, window.location.origin)
        base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
        base.pathname = `${base.pathname.replace(/\/$/, '')}/api/ws/states`
        url = base.toString()
      }
      socket = new WebSocket(url)
      socket.onopen = () => setStreamStatus('live')
      socket.onmessage = event => {
        try { applySnapshot(JSON.parse(event.data)); setError('') } catch { /* ignore malformed snapshots */ }
      }
      socket.onerror = () => socket.close()
      socket.onclose = () => {
        if (stopped) return
        setStreamStatus('reconnecting')
        reconnectTimer = window.setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      stopped = true
      window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [applySnapshot])

  useEffect(() => {
    if (streamStatus === 'live') return
    const timer = window.setInterval(load, 30000)
    return () => window.clearInterval(timer)
  }, [streamStatus, load])

  useEffect(() => () => {
    if (locationWatchRef.current != null) navigator.geolocation.clearWatch(locationWatchRef.current)
  }, [])

  const visible = useMemo(() => (data?.aircraft || []).map(item => userLocation && item.latitude != null && item.longitude != null
    ? { ...item, distance_km: distanceKm(userLocation, item) }
    : item
  ).filter(item => {
    const needle = search.trim().toLowerCase()
    return (!country || item.origin_country === country)
      && (!nearbyOnly || item.distance_km <= nearbyRadius)
      && (!needle || item.callsign.toLowerCase().includes(needle) || item.icao24.includes(needle) || item.origin_country.toLowerCase().includes(needle))
  }).sort((a, b) => userLocation ? (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) : 0), [data, search, country, userLocation, nearbyOnly, nearbyRadius])

  const selectedView = useMemo(() => selected && userLocation && selected.latitude != null && selected.longitude != null
    ? { ...selected, distance_km: distanceKm(userLocation, selected) }
    : selected, [selected, userLocation])

  const stats = data?.stats || {}
  return <div className="app-shell">
    <header>
      <a className="brand" href="#"><span className="brand-mark"><Plane size={19} fill="currentColor" /></span><span>SKY<strong>SCOPE</strong></span></a>
      <nav className={mobileNav ? 'open' : ''}>
        <a className="active" href="#live"><Map size={16}/> Live map</a>
        <a href="#fleet"><Plane size={16}/> Aircraft</a>
        <a href="#about"><Globe2 size={16}/> About</a>
      </nav>
      <div className={`header-status ${streamStatus}`}>
        {streamStatus === 'live' ? <Wifi size={15}/> : <WifiOff size={15}/>}
        <span>{streamStatus === 'live' ? 'LIVE WEBSOCKET' : 'RECONNECTING'}</span>
      </div>
      <button className="menu" onClick={() => setMobileNav(!mobileNav)}><Menu /></button>
    </header>

    <main id="live">
      <section className="intro">
        <div>
          <span className="eyebrow"><span className="pulse"/> {streamStatus === 'live' ? 'LIVE WEBSOCKET AIRSPACE' : 'AIRSPACE INTELLIGENCE'}</span>
          <h1>The world in flight.</h1>
          <p>Explore aircraft moving across the globe in near real time, powered by the OpenSky Network.</p>
        </div>
        <div className="updated"><Clock3 size={16}/><span>Last sync<strong>{data ? new Date(data.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></span><button onClick={load} className={loading ? 'spinning' : ''}><RefreshCw size={17}/></button></div>
      </section>

      <section className="metrics-row">
        <Metric icon={Plane} label="Aircraft tracked" value={(data?.total || 0).toLocaleString()} accent="lime" />
        <Metric icon={CloudSun} label="Currently airborne" value={(stats.airborne || 0).toLocaleString()} />
        <Metric icon={CircleGauge} label="Avg. altitude" value={formatAltitude(stats.avg_altitude_m)} />
        <Metric icon={userLocation ? LocateFixed : Globe2} label={userLocation ? `Within ${nearbyRadius} km` : 'Countries'} value={userLocation ? visible.filter(item => item.distance_km <= nearbyRadius).length : stats.countries || 0} />
      </section>

      <section className="workspace">
        <div className="map-card">
          <div className="toolbar">
            <div className="search"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search callsign, ICAO24, or country"/></div>
            <select value={country} onChange={e => setCountry(e.target.value)}><option value="">All countries</option>{data?.countries.map(c => <option key={c}>{c}</option>)}</select>
            {userLocation && <select className="radius-select" value={nearbyRadius} onChange={event => setNearbyRadius(Number(event.target.value))} aria-label="Nearby radius">
              <option value="100">100 km</option><option value="250">250 km</option><option value="500">500 km</option><option value="1000">1,000 km</option>
            </select>}
            <button className={`locate-button ${nearbyOnly ? 'active' : ''}`} onClick={userLocation ? () => setNearbyOnly(value => !value) : locateMe} title="Find flights near me">
              <LocateFixed size={16}/>{locating ? 'Locating…' : userLocation ? (nearbyOnly ? 'Nearby on' : 'Nearby off') : 'Near me'}
            </button>
            <div className="result-count"><span/>{visible.length.toLocaleString()} visible</div>
          </div>
          {locationError && <div className="location-error">{locationError} <button onClick={locateMe}>Try again</button></div>}
          {error ? <div className="error-state"><Signal size={30}/><strong>Signal interrupted</strong><span>{error}. Make sure the FastAPI server is running.</span><button onClick={load}>Try again</button></div> :
            <WorldMap aircraft={visible} selected={selectedView} onSelect={item => { setSelected(item); setFollowing(false) }} userLocation={userLocation} nearbyRadius={nearbyRadius} following={following} />}
          {data?.source === 'demo' && <div className="demo-badge">DEMO FEED · LIVE API UNAVAILABLE</div>}
        </div>
        <DetailPanel aircraft={selectedView} onClose={() => { setSelected(null); setFollowing(false) }} following={following} onFollow={() => setFollowing(value => !value)} />
      </section>

      <section className="aircraft-section" id="fleet">
        <div className="section-heading"><div><span className="eyebrow">ACTIVE TRAFFIC</span><h2>Aircraft in view</h2></div><span>Showing {Math.min(visible.length, 8)} of {visible.length}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Flight</th><th>Country</th><th>Altitude</th><th>Speed</th><th>Heading</th><th>Status</th><th></th></tr></thead>
          <tbody>{visible.slice(0,8).map(item => <tr key={item.icao24} onClick={() => { setSelected(item); window.scrollTo({top: 300, behavior: 'smooth'}) }}>
            <td><span className="flight-icon"><Plane size={15}/></span><strong>{item.callsign}</strong><small>{item.icao24.toUpperCase()}</small></td>
            <td>{item.origin_country}</td><td>{formatAltitude(item.baro_altitude)}</td><td>{formatSpeed(item.velocity)}</td><td>{item.true_track == null ? '—' : `${Math.round(item.true_track)}°`}</td><td><span className={`status-chip ${item.on_ground ? 'ground' : ''}`}>{item.on_ground ? 'Ground' : 'Airborne'}</span></td><td><ChevronRight size={17}/></td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </main>
    <footer id="about"><div className="brand"><span className="brand-mark"><Plane size={17}/></span><span>SKY<strong>SCOPE</strong></span></div><p>Global air traffic, made visible. Data provided by the OpenSky Network.</p><span>Built with FastAPI + React</span></footer>
  </div>
}
