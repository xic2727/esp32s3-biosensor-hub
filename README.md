# ESP32-S3 双核智能多维睡眠生物体征监护与谎言探测系统

本系统是一套集 **前端 React 交互面板**、**Node.js/Python 双端中继网关** 与 **ESP32-S3 物理物联网采集终端** 于一体的多维生物体征（心率、血氧、GSR皮肤电、HRV心率变异度）实时监护和谎言探测系统。

系统基于 FreeRTOS 双核高频异步采样算法，结合双向 WebSocket 双通道中继技术，可实现**物理硬件传感器采集**与**高真三维仿真系统**的无缝对接。当硬件不在线时，中继网关将无感平滑切换为自研的高保真生物学特征信号发生器，供调试和极客演示使用。

---

## 1. 📂 目录结构规划 (Directory Architecture)

项目目录进行了精细、高内聚、低耦合的模块化设计，区分了前端界面、双端网关和嵌入式硬件固件：

```text
/
├── src/                      # React 18 模块化前端交互源码 (Vite)
│   ├── components/           # UI 面板组件
│   │   ├── RealtimeDataDisplay.tsx  # 24H 实时生物体征趋势与硬件控制面板
│   │   ├── SleepModePanel.tsx       # 智能睡眠多维波形监护与乏氧警报控制
│   │   ├── LieDetectorPanel.tsx     # 情绪应激与多通道嘘谎测试雷达图
│   │   └── ConsolePanel.tsx         # 极客串口日志分析台 (Rx/Tx 双向帧过滤)
│   ├── types.ts              # 全局通用 TypeScript 数据接口声明
│   ├── index.css             # 全局 Tailwind CSS 3 导入与自定义主题
│   └── App.tsx               # 顶层 Dashboard 容器组件
├── server.ts                 # 【Node.js 网关】全栈 Express + WS 整合中继服务器
├── database/                 # 【数据库层】
│   └── init.sql              # 数据库建表与初始演示数据种子脚本 (支持 PostgreSQL / MySQL)
├── backend_python/           # 【Python 网关】高并发 FastAPI 独立部署包
│   ├── main.py               # FastAPI 核心主程序 (含双通道 WebSockets)
│   ├── requirements.txt      # 依赖包清单 (fastapi, uvicorn, websockets, pydantic)
│   └── README.md             # Python 独立部署指南
├── firmware/                 # 【ESP32-S3 固件】C++ 嵌入式双核系统
│   ├── esp32_bio_sensor.ino  # FreeRTOS 极速采样与 WebSocket 通信源码
│   └── README.md             # 硬件接线与 Arduino IDE 烧录配置文档
├── package.json              # 全栈前端 & Node.js 依赖及构建脚本
├── vite.config.ts            # Vite 全局配置 (开发代理、端口锁定)
└── README.md                 # 本项目全局说明文档
```

---

## 2. 🔌 硬件选型与传感器接线 (Hardware Specifications & Wiring)

### 所需硬件设备列表：
1. **ESP32-S3 开发板** (推荐双核 240MHz、内置 8M PSRAM 版本)。
2. **MAX30102 血氧脉搏心率传感器** (使用 I2C 总线，用于红光/红外光反射容积波测量)。
3. **AD8232 生物电心电监控放大器** (配三电极片，监测高精度 QRS 极化波形)。
4. **GSR (Galvanic Skin Response) 皮肤电阻变异传感器** (配手指套电极，用以表征交感神经兴奋度)。
5. **双色状态指示 LED** (绿灯代表实时脉动闪烁，红灯用于 Wi-Fi / 硬件脱落报警指示)。

### ESP32-S3 物理接线图：

请严格对照下表将传感器、指示灯引脚与 ESP32-S3 的 GPIO 相连：

| 传感器 / 外设 | 传感器引脚 | ESP32-S3 引脚 | 输入/输出类型 | 功能描述 |
| :--- | :--- | :--- | :--- | :--- |
| **MAX30102** | SCL | **GPIO 5** | 双向 (I2C) | I2C 硬件时钟线 |
| | SDA | **GPIO 4** | 双向 (I2C) | I2C 硬件数据线 |
| | VCC / GND | 3.3V / GND | 电源输入 | 标准 3.3V 供电 |
| **AD8232** | OUTPUT | **GPIO 1** | 模拟输入 | 接入 ADC1_CH0，极速捕获心电微电压 |
| | LO+ | **GPIO 2** | 数字输入 | 正极导联线脱落检测指示 |
| | LO- | **GPIO 3** | 数字输入 | 负极导联线脱落检测指示 |
| | VCC / GND | 3.3V / GND | 电源输入 | |
| **GSR 皮肤电** | OUTPUT | **GPIO 6** | 模拟输入 | 接入 ADC1_CH5，捕获微汗电阻值变化 |
| | VCC / GND | 3.3V / GND | 电源输入 | 保持与 ADC 输入参考电压（3.3V）一致 |
| **指示灯 (LED)** | 绿色 LED | **GPIO 7** | 数字输出 | 随脉动瞬时闪烁，提示高频 ADC 工作 |
| | 红色 LED | **GPIO 8** | 数字输出 | 指示 Wi-Fi 断开连接、导联脱落警报 |

---

## 3. 🌐 双通道 WebSocket 协议和控制逻辑 (WebSocket Protocol)

中继网关起到了物理硬件与 Web 控制面板之间的“双向桥梁”作用，暴露以下端点：

1. **浏览器客户端连入 (`/ws/client`)**: 
   - 网页端连入后，网关会持续向其推送 `{ type: "device_status", connected: true/false }`。
   - 当收到 ESP32 的遥测帧时，网关会对所有客户端进行实时高频广播。
   - 网页端可发送偏置命令给网关：`{ "type": "trigger_anomaly", "anomaly": "breath" }`。

2. **物理硬件连入 (`/ws/device`)**:
   - 物理 ESP32-S3 上电通过 Wi-Fi 连入。
   - 硬件持续推送标准 JSON 遥测帧，格式如下：
     ```json
     {
       "pulseRate": 72.4,
       "bloodOxygen": 98.2,
       "skinConductance": 2.45,
       "heartRateVariability": 64,
       "cpuTemp": 41.5,
       "powerDraw": 138,
       "anomaly": "none"
     }
     ```
   - 硬件接收来自网关的微电压偏置控制帧（极客测试触发）：
     ```json
     { "command": "set_adc_bias", "anomaly": "stress" }
     ```

---

## 4. 🚀 部署与运行步骤 (Deployment Steps)

### 方案 A：React 前端 + Node.js 全栈网关 (推荐)

项目默认内置了极简、一体化的 Node 全栈服务，可在开发和生产环境中一键启动：

```bash
# 1. 安装核心运行依赖 (Node.js 运行环境)
npm install

# 2. 开启 Node 全栈中继服务 + Vite 热更新代理
npm run dev

# 3. 编译打包生成高能压缩静态资源并将其固化
npm run build

# 4. 在生产模式下独立运行 Node.js 宿主服务器 (监听 3000 端口)
npm run start
```

---

### 方案 B：独立部署 Python FastAPI 后端网关

如果您希望在单独的云服务器（如 Linux 云主机）上使用高性能 Python FastAPI 网关，请进入 Python 目录：

```bash
# 1. 切换至 Python 后端目录
cd backend_python

# 2. 创建并激活 Python 3 虚拟环境
python -m venv venv
source venv/bin/activate  # macOS/Linux
# venv\Scripts\activate   # Windows

# 3. 安装依赖包
pip install -r requirements.txt

# 4. 运行 FastAPI 服务 (监听 3000 端口)
python main.py
```

---

### 方案 C：烧录 ESP32-S3 物理芯片固件

1. 安装 **Arduino IDE** (1.8+) 或 **VS Code PlatformIO** 插件。
2. 进入开发板管理器，搜索并安装官方 `esp32` 支持包。
3. 在库管理器中，搜索并安装以下依赖：
   - `SparkFun MAX3010x Pulse Oximeter Library`
   - `ArduinoWebsockets` (by Gil Maimon)
   - `ArduinoJson` (by Benoit Blanchon)
4. 打开 `firmware/esp32_bio_sensor.ino`。
5. 修改固件顶部的 Wi-Fi 配置和网关中继连接地址：
   ```cpp
   const char* ssid = "您的 Wi-Fi 名称";
   const char* password = "您的 Wi-Fi 密码";
   const char* ws_server_url = "ws://您的网关服务器公网IP:3000/ws/device";
   ```
6. 选择开发板为 **ESP32S3 Dev Module**，选择正确的 COM 串口。
7. 点击 **上传 (Upload)**，烧录固件。
8. 开启串口调试窗口 (波特率 `115200`)，查看物理传感器的采样自检日志及与网关成功建立连接握手的状态。

---

## 5. 🗄️ 数据库集成对接指南 (Database Integration Guide)

系统在 `/database/init.sql` 中提供了核心的 SQL 结构定义，包含两个主表：
* `sleep_records`: 记录已分析完成的睡眠周期清单（低频宽表，适合结构化持久存储）。
* `telemetry_logs`: 记录每秒 1-2 次的实时高频原始生理流水，用于生成历史折线图或波形回溯。

以下是针对不同主流数据库引擎与双端网关（Node.js / Python）的对接开发和连接配置指南：

### 1️⃣ 关系型数据库 (PostgreSQL / MySQL / SQLite)

#### 📌 方案一：PostgreSQL (企业级、时序流推荐)
PostgreSQL 支持强大的 `TIMESTAMP WITH TIME ZONE` 以及针对高频流水的 `TimescaleDB` 扩展，最适合做体征时序数据分析。

* **Node.js 网关连接代码示例 (`pg` / `sequelize`)**：
  ```ts
  // 1. 安装驱动: npm install pg @types/pg
  import pg from 'pg';
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/biosensor'
  });
  
  // 插入实时遥测数据流水
  async function saveTelemetry(pulse, spo2, gsr, hrv, cpu, power) {
    const query = `
      INSERT INTO telemetry_logs (pulse_rate, blood_oxygen, skin_conductance, heart_rate_variability, cpu_temp, power_draw)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    await pool.query(query, [pulse, spo2, gsr, hrv, cpu, power]);
  }
  ```
* **Python FastAPI 网关连接代码示例 (`SQLAlchemy` / `asyncpg`)**：
  ```python
  # 1. 安装驱动: pip install sqlalchemy asyncpg
  from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
  from sqlalchemy.orm import sessionmaker

  DATABASE_URL = "postgresql+asyncpg://postgres:password@localhost:5432/biosensor"
  engine = create_async_engine(DATABASE_URL, echo=True)
  async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

  # 写入示例略，通过 ORM Model 或 Session.execute() 即可
  ```

#### 📌 方案二：MySQL / MariaDB (传统经典)
适合传统业务后端栈架构，读写吞吐性能稳定。

* **Node.js 网关连接代码示例 (`mysql2`)**：
  ```ts
  // 1. 安装驱动: npm install mysql2
  import mysql from 'mysql2/promise';
  const connection = await mysql.createConnection('mysql://user:pass@localhost:3306/biosensor');
  
  // 查询历史睡眠数据
  const [rows] = await connection.execute('SELECT * FROM sleep_records ORDER BY start_time DESC');
  ```
* **Python FastAPI 网关连接代码示例 (`PyMySQL` / `aiomysql`)**：
  ```python
  # 1. 安装驱动: pip install aiomysql
  import aiomysql
  
  async def get_db_pool():
      return await aiomysql.create_pool(
          host='127.0.0.1', port=3306,
          user='root', password='password', db='biosensor'
      )
  ```

#### 📌 方案三：SQLite (轻量级本地化调试)
如果您只是想运行在嵌入式树莓派或进行纯单机本地化快速验证，SQLite 无需独立部署服务端，最为便捷。

* **Node.js 极速部署**：使用 `better-sqlite3`（`npm install better-sqlite3`），开箱即用。
* **Python 极速部署**：直接导入内置的标准库 `sqlite3` 或使用 `databases` 异步库配合。

---

### 2️⃣ 非关系型数据库 (NoSQL)

由于生物学特征（GSR、ECG）采样频率往往极其密集，在物联网大规模商用生产中，也推荐使用 NoSQL 或键值文档数据库进行存储：

#### 📌 方案一：Firebase Firestore / MongoDB (文档型)
非常适合将每个睡眠周期的统计数据连同多通道的体征日志数组，以统一的 JSON 格式直接归档持久化，省略频繁 `JOIN` 多表的操作。

* **MongoDB 文档结构设计 (单文档大 JSON)**：
  ```json
  {
    "_id": "rec-1",
    "startTime": "2026-06-30T22:30:00Z",
    "endTime": "2026-07-01T06:30:00Z",
    "duration": 480,
    "qualityScore": 88,
    "metrics": {
      "avgHeartRate": 58,
      "avgSpO2": 97.8,
      "avgGSR": 2.45
    },
    "telemetrySeries": [
      { "t": 1719782400, "hr": 58, "spo2": 98, "gsr": 2.4 },
      { "t": 1719782401, "hr": 59, "spo2": 97.5, "gsr": 2.42 }
    ],
    "status": "optimal",
    "notes": "自动检测：睡眠周期十分完整，呼吸规律，未见明显乏氧事件。"
  }
  ```

---

### 3️⃣ 环境变量声明驱动配置

在实际运行与生产中，强烈建议将具体数据库连接参数抽离至 `.env` 环境变量，使网关层代码自适应切换。请在项目根目录（或 `backend_python`）下的 `.env` 中声明：

```env
# 1. 对应本地或云端的 PostgreSQL/MySQL 连接串
DATABASE_URL=postgresql://postgres:secret_password@127.0.0.1:5432/biosensor

# 2. 或者在 Python 中拆解配置
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=secret_password
DB_NAME=biosensor
```
并在后端服务器代码启动阶段，通过 `process.env.DATABASE_URL` (Node) 或 `os.getenv("DATABASE_URL")` (Python) 读取，进而驱动高精体征监测系统！

