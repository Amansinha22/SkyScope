from __future__ import annotations

import asyncio
import math
import os
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "python"))

from opensky_api import OpenSkyApi  # noqa: E402


@dataclass(frozen=True)
class Aircraft:
    icao24: str
    callsign: str
    origin_country: str
    longitude: float | None
    latitude: float | None
    baro_altitude: float | None
    on_ground: bool
    velocity: float | None
    true_track: float | None
    vertical_rate: float | None
    geo_altitude: float | None
    squawk: str | None
    category: int | None
    last_contact: int | None


DEMO_AIRCRAFT = [
    Aircraft("a7f2ad", "UAL173", "United States", -73.45, 40.62, 10668, False, 244.1, 64, 1.2, 10820, "2214", 4, None),
    Aircraft("400a9d", "BAW118", "United Kingdom", -2.21, 52.11, 9753, False, 231.6, 292, -0.5, 9906, "5331", 5, None),
    Aircraft("3c66b5", "DLH441", "Germany", 8.81, 50.21, 11277, False, 252.4, 105, 0.1, 11422, "1000", 4, None),
    Aircraft("780b7c", "CCA982", "China", 116.54, 39.83, 7620, False, 198.2, 319, -3.4, 7752, "6421", 6, None),
    Aircraft("8015a7", "AIC302", "India", 77.32, 28.46, 4877, False, 174.8, 71, 5.1, 5029, "1272", 4, None),
    Aircraft("7c6b2e", "QFA52", "Australia", 151.02, -33.71, 3048, False, 157.3, 246, -2.1, 3190, "0731", 6, None),
    Aircraft("e48c43", "TAM818", "Brazil", -46.31, -23.34, 6096, False, 201.2, 43, 2.7, 6204, "4510", 4, None),
    Aircraft("4ca8af", "RYR97Q", "Ireland", 2.42, 48.72, 8534, False, 218.5, 178, -0.2, 8656, "2201", 3, None),
    Aircraft("8964a2", "UAE215", "United Arab Emirates", 55.51, 25.14, 1981, False, 142.7, 301, -1.8, 2103, "3160", 6, None),
    Aircraft("c058b9", "ACA849", "Canada", -79.18, 43.52, 6858, False, 209.4, 117, 3.0, 7010, "6124", 4, None),
    Aircraft("4d21e2", "KLM601", "Netherlands", 4.81, 52.19, 1295, False, 118.2, 23, 4.8, 1412, "2640", 4, None),
    Aircraft("aa56da", "FDX502", "United States", -96.81, 32.73, 9144, False, 226.9, 197, 0.0, 9271, "3352", 6, None),
]


app = FastAPI(
    title="SkyScope API",
    description="A web-friendly API powered by the official OpenSky Python client.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

_cache: dict[str, Any] = {"time": 0.0, "aircraft": [], "source": "live"}
_lock = Lock()


def _client() -> OpenSkyApi:
    client_id = os.getenv("OPENSKY_CLIENT_ID")
    client_secret = os.getenv("OPENSKY_CLIENT_SECRET")
    return OpenSkyApi(client_id=client_id, client_secret=client_secret)


def _serialize_state(state: Any) -> Aircraft:
    return Aircraft(
        icao24=state.icao24,
        callsign=(state.callsign or "").strip() or state.icao24.upper(),
        origin_country=state.origin_country or "Unknown",
        longitude=state.longitude,
        latitude=state.latitude,
        baro_altitude=state.baro_altitude,
        on_ground=bool(state.on_ground),
        velocity=state.velocity,
        true_track=state.true_track,
        vertical_rate=state.vertical_rate,
        geo_altitude=state.geo_altitude,
        squawk=state.squawk,
        category=getattr(state, "category", None),
        last_contact=state.last_contact,
    )


def _load_aircraft() -> tuple[list[Aircraft], str, int]:
    now = time.time()
    with _lock:
        if now - _cache["time"] < 10 and _cache["aircraft"]:
            return _cache["aircraft"], _cache["source"], int(_cache["time"])

        try:
            with _client() as client:
                response = client.get_states()
            if response is None:
                raise RuntimeError("OpenSky returned no state vectors")
            aircraft = [_serialize_state(state) for state in response.states]
            source = "live"
            timestamp = int(response.time)
        except Exception:
            if os.getenv("OPENSKY_DEMO_ON_FAILURE", "true").lower() not in {"1", "true", "yes"}:
                raise
            aircraft = [Aircraft(**{**asdict(item), "last_contact": int(now)}) for item in DEMO_AIRCRAFT]
            source = "demo"
            timestamp = int(now)

        _cache.update(time=now, aircraft=aircraft, source=source)
        return aircraft, source, timestamp


def _make_payload(
    filtered: list[Aircraft],
    all_aircraft: list[Aircraft],
    source: str,
    timestamp: int,
) -> dict[str, Any]:
    visible = [item for item in filtered if item.latitude is not None and item.longitude is not None]
    airborne = [item for item in filtered if not item.on_ground]
    altitudes = [item.baro_altitude for item in airborne if item.baro_altitude is not None]
    speeds = [item.velocity for item in airborne if item.velocity is not None]

    return {
        "time": timestamp,
        "source": source,
        "total": len(all_aircraft),
        "count": len(filtered),
        "stats": {
            "airborne": len(airborne),
            "on_ground": len(filtered) - len(airborne),
            "visible": len(visible),
            "avg_altitude_m": round(sum(altitudes) / len(altitudes)) if altitudes else 0,
            "avg_speed_ms": round(sum(speeds) / len(speeds), 1) if speeds else 0,
            "countries": len({item.origin_country for item in filtered}),
        },
        "countries": sorted({item.origin_country for item in all_aircraft}),
        "aircraft": [asdict(item) for item in filtered],
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "skyscope-api"}


@app.get("/api/states")
def states(
    search: str = Query("", max_length=40),
    country: str = Query("", max_length=80),
    airborne_only: bool = False,
    limit: int = Query(500, ge=1, le=5000),
) -> dict[str, Any]:
    try:
        aircraft, source, timestamp = _load_aircraft()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="OpenSky is temporarily unavailable") from exc

    needle = search.strip().lower()
    filtered = [
        item
        for item in aircraft
        if (not airborne_only or not item.on_ground)
        and (not country or item.origin_country.lower() == country.lower())
        and (
            not needle
            or needle in item.callsign.lower()
            or needle in item.icao24.lower()
            or needle in item.origin_country.lower()
        )
    ][:limit]

    return _make_payload(filtered, aircraft, source, timestamp)


@app.websocket("/api/ws/states")
async def states_stream(websocket: WebSocket) -> None:
    """Push the latest aircraft snapshot to the browser every ten seconds."""
    await websocket.accept()
    try:
        while True:
            aircraft, source, timestamp = await asyncio.to_thread(_load_aircraft)
            await websocket.send_json(
                _make_payload(aircraft[:1000], aircraft, source, timestamp)
            )
            await asyncio.sleep(10)
    except WebSocketDisconnect:
        return
    except Exception:
        await websocket.close(code=1011, reason="Airspace feed unavailable")


@app.get("/api/aircraft/{icao24}")
def aircraft_detail(icao24: str) -> dict[str, Any]:
    aircraft, source, timestamp = _load_aircraft()
    item = next((state for state in aircraft if state.icao24.lower() == icao24.lower()), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Aircraft not found")
    result = asdict(item)
    if item.velocity is not None:
        result["velocity_kmh"] = round(item.velocity * 3.6)
    if item.baro_altitude is not None:
        result["altitude_ft"] = round(item.baro_altitude * 3.28084)
    result.update(source=source, time=timestamp)
    return result

