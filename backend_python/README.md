# FastAPI 生物体征与睡眠监测网关/中继服务器 (Python FastAPI)

本目录包含高阶、轻量、高并发的 **Python FastAPI** 后端网关实现，它与项目根目录下的 **Node fullstack 中继**（`server.ts`）在 API 端点、WebSocket 双向握手、协议包格式以及 ESP32-S3 交互控制上完全对标一致。

您可以随时使用本 Python 目录在云端独立部署（例如部署至阿里云、腾讯云、AWS 或是 Docker 环境），完美对接嵌入式传感器硬件。

---

## 1. 目录结构设计 (Architecture)

```text
backend_python/
├── main.py              # FastAPI 核心主程序（含双通道 WebSocket 广播中继及 REST 路由）
├── requirements.txt     # Python 依赖清单
└── README.md            # 本说明文档
```

---

## 2. 核心功能及通信协议说明

FastAPI 服务器充当一个**智能中继 (Relay Router)**：
1. **`/ws/device`**: 负责维持物理 ESP32-S3 的高速 WebSocket 物理接入。当收到硬件传来的多维采样遥测帧（心率、血氧、GSR、HRV 等），将其进行高频解包，并立即**透传广播**给所有前端浏览器。
2. **`/ws/client`**: 负责维系前端 React 交互面板的 WebSocket 接入。当用户在网页端点击 “说谎惊恐”、“腹式深呼吸” 或 “睡眠暂停” 异常仿真按钮时，中继会秒级**打包并下发**指令（`set_adc_bias`）给物理 ESP32，控制芯片内部 DAC/ADC 电路的仿真。
3. **REST APIs (`/api/*`)**:
   - `GET /api/health`: 基础健康检测与服务器时间戳同步。
   - `GET /api/sleep-records`: 睡眠历史清单拉取。
   - `POST /api/sleep-records`: 提供人工打标/睡眠记录保存，直接持久化写入数据层。
   - `GET /api/device-status`: 实时查询物理硬件和连接客户端的池子大小。

---

## 3. 本地启动与部署步骤

### 步骤 1：安装 Python 运行环境
确保本地已安装 Python 3.8+。推荐通过 `venv` 创建独立虚拟环境以避免依赖冲突：
```bash
# 创建虚拟环境
python -m venv venv

# 激活虚拟环境 (Windows)
venv\Scripts\activate

# 激活虚拟环境 (macOS / Linux)
source venv/bin/activate
```

### 步骤 2：安装依赖
进入当前 `backend_python` 目录，安装 requirements.txt 声明的库：
```bash
pip install -r requirements.txt
```

### 步骤 3：启动 FastAPI 服务
运行主程序启动开发服务器：
```bash
python main.py
```
或者使用 `uvicorn` 直接驱动：
```bash
uvicorn main:app --host 0.0.0.0 --port 3000 --reload
```

---

## 4. 物理部署与对接配置

- 当您在公网服务器运行本 FastAPI 服务时，只需要将 **ESP32 固件** 中的 `ws_server_url` 指向您的公网 IP 即可：
  ```cpp
  // 修改 ESP32-S3 固件中的 WebSocket 网关连接
  const char* ws_server_url = "ws://<您的服务器公网IP>:3000/ws/device";
  ```
- 此时，前端网页也会与此中继直接连通，物理传感器的所有波形走势都会瞬时在网页看板中呈现！
