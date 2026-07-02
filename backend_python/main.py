from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Set, Optional, Dict, Any
import datetime
import uvicorn
import json

app = FastAPI(
    title="ESP32-S3 Biosensor Hub API",
    description="Python FastAPI implementation for Bio-telemetry and sleep recording",
    version="1.0.0"
)

# Enable CORS for frontend clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data Structures
class SleepRecord(BaseModel):
    id: Optional[str] = None
    startTime: str
    endTime: str
    duration: int  # in minutes
    qualityScore: int
    averageHeartRate: float
    averageSpO2: float
    deepSleepPercent: int
    remSleepPercent: int
    lightSleepPercent: int
    status: str  # 'optimal' | 'regular' | 'hypoxia' | 'warning'
    notes: Optional[str] = None

# In-memory storage mirroring database table
sleep_records_db: List[Dict[str, Any]] = [
    {
        "id": "rec-1",
        "startTime": "2026-06-30T22:30:00Z",
        "endTime": "2026-07-01T06:30:00Z",
        "duration": 480,
        "qualityScore": 88,
        "averageHeartRate": 58.0,
        "averageSpO2": 97.8,
        "deepSleepPercent": 24,
        "remSleepPercent": 22,
        "lightSleepPercent": 54,
        "status": "optimal",
        "notes": "自动检测：睡眠周期十分完整，呼吸规律，未见明显乏氧事件。"
    },
    {
        "id": "rec-2",
        "startTime": "2026-06-29T23:15:00Z",
        "endTime": "2026-07-30T06:45:00Z",
        "duration": 450,
        "qualityScore": 64,
        "averageHeartRate": 63.0,
        "averageSpO2": 91.2,
        "deepSleepPercent": 12,
        "remSleepPercent": 18,
        "lightSleepPercent": 70,
        "status": "hypoxia",
        "notes": "自动警告：凌晨 02:14 - 02:40 间检测到 4 次一过性睡眠呼吸暂停，最低血氧跌至 87%。建议调高止鼾枕高度。"
    }
]

# Connection Manager for WebSockets
class ConnectionManager:
    def __init__(self):
        # Store active Web Browser clients
        self.client_connections: Set[WebSocket] = set()
        # Store active physical ESP32 devices
        self.device_connections: Set[WebSocket] = set()

    async def connect_client(self, websocket: WebSocket):
        await websocket.accept()
        self.client_connections.add(websocket)
        # Notify the new client about current hardware connection status
        status_payload = {
            "type": "device_status",
            "connected": len(self.device_connections) > 0
        }
        await websocket.send_text(json.dumps(status_payload))

    def disconnect_client(self, websocket: WebSocket):
        if websocket in self.client_connections:
            self.client_connections.remove(websocket)

    async def connect_device(self, websocket: WebSocket):
        await websocket.accept()
        self.device_connections.add(websocket)
        # Broadcast hardware ONLINE status to all connected web dashboards
        await self.broadcast_to_clients({
            "type": "device_status",
            "connected": True
        })

    async def disconnect_device(self, websocket: WebSocket):
        if websocket in self.device_connections:
            self.device_connections.remove(websocket)
        # Broadcast hardware OFFLINE status to all connected web dashboards
        await self.broadcast_to_clients({
            "type": "device_status",
            "connected": False
        })

    async def broadcast_to_clients(self, payload: dict):
        payload_str = json.dumps(payload)
        disconnected = set()
        for client in self.client_connections:
            try:
                await client.send_text(payload_str)
            except Exception:
                disconnected.add(client)
        
        for client in disconnected:
            self.client_connections.remove(client)

    async def broadcast_to_devices(self, payload: dict):
        payload_str = json.dumps(payload)
        disconnected = set()
        for device in self.device_connections:
            try:
                await device.send_text(payload_str)
            except Exception:
                disconnected.add(device)
                
        for device in disconnected:
            self.device_connections.remove(device)

manager = ConnectionManager()

# --- HTTP API REST ENDPOINTS ---

@app.get("/api/health")
def health_check():
    """Service health state monitor."""
    return {
        "status": "ok",
        "framework": "FastAPI (Python)",
        "serverTime": datetime.datetime.utcnow().isoformat() + "Z"
    }

@app.get("/api/sleep-records", response_model=List[SleepRecord])
def get_sleep_records():
    """Retrieve all historical sleep logs."""
    return [SleepRecord(**rec) for rec in sleep_records_db]

@app.post("/api/sleep-records", response_model=SleepRecord, status_code=210)
def create_sleep_record(record: SleepRecord):
    """Add a new custom/hand-labelled sleep record."""
    new_id = f"rec-{int(datetime.datetime.utcnow().timestamp() * 1000)}"
    record_dict = record.dict()
    record_dict["id"] = new_id
    
    # Prepend to mimic sorting desc
    sleep_records_db.insert(0, record_dict)
    return SleepRecord(**record_dict)

@app.get("/api/device-status")
def get_device_status():
    """Query connection statistics of the biosensor hub."""
    return {
        "connected": len(manager.device_connections) > 0,
        "deviceCount": len(manager.device_connections),
        "clientCount": len(manager.client_connections)
    }

# --- WEBSOCKET ENDPOINTS ---

@app.websocket("/ws/client")
async def websocket_client_endpoint(websocket: WebSocket):
    """Dashboard UI Client Websocket connection pool."""
    await manager.connect_client(websocket)
    print(f"💻 Dashboard Connected. Clients Active: {len(manager.client_connections)}")
    try:
        while True:
            # Receive controls from front-end (e.g. trigger anomaly bias)
            data_str = await websocket.receive_text()
            try:
                action = json.loads(data_str)
                print(f"📩 Command from dashboard: {action}")
                
                if action.get("type") == "trigger_anomaly":
                    # Forward configuration to ESP32 physical boards
                    await manager.broadcast_to_devices({
                        "command": "set_adc_bias",
                        "anomaly": action.get("anomaly", "none")
                    })
            except ValueError:
                print("⚠️ Received non-JSON message from client")
    except WebSocketDisconnect:
        manager.disconnect_client(websocket)
        print(f"💻 Dashboard Disconnected. Clients Active: {len(manager.client_connections)}")
    except Exception as e:
        print(f"❌ Client Exception: {e}")
        manager.disconnect_client(websocket)

@app.websocket("/ws/device")
async def websocket_device_endpoint(websocket: WebSocket):
    """Physical ESP32-S3 Biosensor Websocket terminal gateway."""
    await manager.connect_device(websocket)
    print(f"🔌 Physical Biosensor ESP32 connected! Devices Active: {len(manager.device_connections)}")
    try:
        while True:
            # Read real biometric telemetry packets from ESP32
            data_str = await websocket.receive_text()
            try:
                data = json.loads(data_str)
                # Broadcast real hardware frames instantly to browser dashboards
                await manager.broadcast_to_clients({
                    "type": "telemetry",
                    "source": "hardware",
                    "data": data
                })
            except ValueError:
                print("⚠️ Malformed sensor telemetry packet received")
    except WebSocketDisconnect:
        await manager.disconnect_device(websocket)
        print(f"❌ Physical Biosensor ESP32 disconnected! Devices Active: {len(manager.device_connections)}")
    except Exception as e:
        print(f"❌ Device Exception: {e}")
        await manager.disconnect_device(websocket)

if __name__ == "__main__":
    print("🚀 Starting FastAPI High-Performance Biosensor Proxy Server...")
    uvicorn.run("main:app", host="0.0.0.0", port=3000, reload=True)
