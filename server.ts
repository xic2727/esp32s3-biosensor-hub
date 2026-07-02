import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

// Structure of a Sleep Record
interface SleepRecord {
  id: string;
  startTime: string;
  endTime: string;
  duration: number; // minutes
  qualityScore: number;
  averageHeartRate: number;
  averageSpO2: number;
  deepSleepPercent: number;
  remSleepPercent: number;
  lightSleepPercent: number;
  status: 'optimal' | 'regular' | 'hypoxia' | 'warning';
  notes?: string;
}

// In-memory array acting as our persistent storage
let sleepRecords: SleepRecord[] = [
  {
    id: 'rec-1',
    startTime: '2026-06-30T22:30:00Z',
    endTime: '2026-07-01T06:30:00Z',
    duration: 480,
    qualityScore: 88,
    averageHeartRate: 58,
    averageSpO2: 97.8,
    deepSleepPercent: 24,
    remSleepPercent: 22,
    lightSleepPercent: 54,
    status: 'optimal',
    notes: '自动检测：睡眠周期十分完整，呼吸规律，未见明显乏氧事件。'
  },
  {
    id: 'rec-2',
    startTime: '2026-06-29T23:15:00Z',
    endTime: '2026-07-30T06:45:00Z',
    duration: 450,
    qualityScore: 64,
    averageHeartRate: 63,
    averageSpO2: 91.2,
    deepSleepPercent: 12,
    remSleepPercent: 18,
    lightSleepPercent: 70,
    status: 'hypoxia',
    notes: '自动警告：凌晨 02:14 - 02:40 间检测到 4 次一过性睡眠呼吸暂停，最低血氧跌至 87%。建议调高止鼾枕高度。'
  }
];

async function startServer() {
  const app = express();
  const server = createServer(app);
  const PORT = 3000;

  app.use(express.json());

  // WebSocket Server Setup
  const wss = new WebSocketServer({ noServer: true });

  // Connected clients and ESP32 devices list
  const clientSockets = new Set<WebSocket>();
  const deviceSockets = new Set<WebSocket>();

  // WebSocket upgrades matching path routing
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

    if (pathname === '/ws/client' || pathname === '/ws/device') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Connection Handler
  wss.on('connection', (ws: WebSocket, request) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

    if (pathname === '/ws/device') {
      console.log('🔌 ESP32-S3 Physical Biosensor Connected');
      deviceSockets.add(ws);

      // Notify Web Clients that the physical hardware is Online
      broadcastToClients({ type: 'device_status', connected: true });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          // Broadcast real biometric stream received from physical ESP32 to all client dashboards
          broadcastToClients({
            type: 'telemetry',
            source: 'hardware',
            data: data
          });
        } catch (err) {
          console.error('Failed to parse ESP32 message:', err);
        }
      });

      ws.on('close', () => {
        console.log('❌ ESP32-S3 Physical Biosensor Disconnected');
        deviceSockets.delete(ws);
        broadcastToClients({ type: 'device_status', connected: false });
      });

      ws.on('error', (err) => {
        console.error('ESP32 Socket Error:', err);
        deviceSockets.delete(ws);
        broadcastToClients({ type: 'device_status', connected: false });
      });

    } else if (pathname === '/ws/client') {
      console.log('💻 React Web Dashboard Client Connected');
      clientSockets.add(ws);

      // Immediately sync current physical hardware connection status to this client
      ws.send(JSON.stringify({
        type: 'device_status',
        connected: deviceSockets.size > 0
      }));

      // Listen for command requests from the frontend client (e.g. triggering an anomaly offset)
      ws.on('message', (message) => {
        try {
          const action = JSON.parse(message.toString());
          console.log('Received command from Client:', action);

          if (action.type === 'trigger_anomaly') {
            // Forward the calibration shift request to the real physical ESP32-S3 board
            broadcastToDevices({
              command: 'set_adc_bias',
              anomaly: action.anomaly // 'breath' | 'stress' | 'apnea' | 'none'
            });
          }
        } catch (err) {
          console.error('Failed to parse Client action:', err);
        }
      });

      ws.on('close', () => {
        console.log('💻 Client disconnected');
        clientSockets.delete(ws);
      });
    }
  });

  // Broadcast Helper to web clients
  function broadcastToClients(payload: any) {
    const payloadStr = JSON.stringify(payload);
    for (const client of clientSockets) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payloadStr);
      }
    }
  }

  // Broadcast Helper to ESP32 physical boards
  function broadcastToDevices(payload: any) {
    const payloadStr = JSON.stringify(payload);
    for (const device of deviceSockets) {
      if (device.readyState === WebSocket.OPEN) {
        device.send(payloadStr);
      }
    }
  }

  // --- REST APIs ---

  // Health check API
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', serverTime: new Date().toISOString() });
  });

  // Fetch all sleep logs
  app.get('/api/sleep-records', (req, res) => {
    res.json(sleepRecords);
  });

  // Log a new sleep record
  app.post('/api/sleep-records', (req, res) => {
    const newRecord: SleepRecord = {
      id: `rec-${Date.now()}`,
      startTime: req.body.startTime || new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
      endTime: req.body.endTime || new Date().toISOString(),
      duration: Number(req.body.duration) || 480,
      qualityScore: Number(req.body.qualityScore) || 85,
      averageHeartRate: Number(req.body.averageHeartRate) || 60,
      averageSpO2: Number(req.body.averageSpO2) || 98.0,
      deepSleepPercent: Number(req.body.deepSleepPercent) || 20,
      remSleepPercent: Number(req.body.remSleepPercent) || 20,
      lightSleepPercent: Number(req.body.lightSleepPercent) || 60,
      status: req.body.status || 'optimal',
      notes: req.body.notes || '人工打标：由用户手动同步完成。'
    };

    sleepRecords.unshift(newRecord);
    res.status(201).json(newRecord);
  });

  // Get physical ESP32 state
  app.get('/api/device-status', (req, res) => {
    res.json({
      connected: deviceSockets.size > 0,
      deviceCount: deviceSockets.size,
      clientCount: clientSockets.size
    });
  });

  // --- Vite & Production SPA Static Routing ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ESP32-S3 Sleep Biosensor Hub Server running on http://localhost:${PORT}`);
    console.log(`   - REST endpoints exposed at /api/*`);
    console.log(`   - Client Websockets listening on ws://localhost:${PORT}/ws/client`);
    console.log(`   - Hardware Websockets listening on ws://localhost:${PORT}/ws/device`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
});
