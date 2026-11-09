# SkyScope web application

This repository now includes a FastAPI backend and a React/Vite frontend for exploring OpenSky aircraft state vectors.

The live map uses [MapLibre GL JS](https://maplibre.org/) with the standard OpenStreetMap raster tile service. The map uses an inline style, so it does not depend on a remote style document. OpenStreetMap attribution is displayed directly on the map. The public tile service is suitable for normal interactive viewing; review the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) before a high-traffic production launch.

## Run the backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Optional authenticated access can be configured by copying `.env.example` to `.env` and exporting `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET`. Anonymous access works with lower rate limits. If OpenSky is unavailable, the app uses a clearly labelled demonstration feed by default.

API documentation is available at `http://localhost:8000/docs`.

The backend also exposes `ws://localhost:8000/api/ws/states`. It pushes a fresh aircraft snapshot every 10 seconds and the frontend reconnects automatically if the connection drops.

## Run the frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. During development, Vite proxies `/api` to the FastAPI server on port 8000.

Use **Near me** on the map to grant browser location access. SkyScope watches your location, draws a configurable 100–1,000 km search radius, and shows the closest flights first. Browser geolocation works on `localhost` or an HTTPS deployment.

## Production build

```powershell
cd frontend
npm run build
```

Set `VITE_API_URL` to the deployed backend URL when the frontend and backend are hosted separately.
