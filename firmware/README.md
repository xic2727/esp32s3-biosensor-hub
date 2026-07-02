# ESP32-S3 睡眠生物体征及谎言探测终端固件说明

此目录包含 ESP32-S3 智能多维生物传感器的硬件固件。本传感器采用双核 FreeRTOS 架构，Core 0 负责高精度的传感器中断采样及心电（ECG）、皮肤电（GSR）脉搏波信号处理算法；Core 1 负责 Wi-Fi 无线通信及 WebSocket 帧同步。

---

## 1. 硬件连接图 (Wiring Guide)

请按照下表将传感器、指示灯与您的 **ESP32-S3** 开发板相连：

| 传感器 / 硬件 | ESP32-S3 引脚 | 类型 | 描述 |
| :--- | :--- | :--- | :--- |
| **MAX30102 血氧心率** | | | I2C 接口 |
| SCL | GPIO 5 | 输入 | I2C 时钟线 |
| SDA | GPIO 4 | 双向 | I2C 数据线 |
| VCC | 3.3V | 电源 | 3.3V 供电 |
| GND | GND | 地 | 共同参考地 |
| **AD8232 生物电心电** | | | 心电模拟和导联脱落检测 |
| OUTPUT | GPIO 1 | 模拟输入 | 心电（ECG）模拟信号输入 (ADC1_CH0) |
| LO+ | GPIO 2 | 数字输入 | 导联正极脱落报警 |
| LO- | GPIO 3 | 数字输入 | 导联负极脱落报警 |
| VCC | 3.3V | 电源 | |
| GND | GND | 地 | |
| **GSR 皮肤电电导** | | | 皮肤出汗/情绪应激检测 |
| OUTPUT | GPIO 6 | 模拟输入 | 皮肤电阻变异模拟输入 (ADC1_CH5) |
| VCC | 3.3V / 5.0V | 电源 | 建议使用 3.3V 保持 ADC 范围一致 |
| GND | GND | 地 | |
| **状态指示灯** | | | |
| 绿色 LED | GPIO 7 | 输出 | 随心跳脉动同步闪烁 (指示 ADC 工作状态) |
| 红色 LED | GPIO 8 | 输出 | 常亮或闪烁指示网络丢失、硬件脱落报警 |

---

## 2. 软件依赖安装 (Software Dependencies)

在 Arduino IDE 或 PlatformIO 中编译前，请确保安装了以下开源库：

1. **Adafruit BusIO** & **Wire** (核心 I2C 支持)
2. **SparkFun MAX3010x Pulse Oximeter Library** (由 SparkFun 开发的 MAX30102 驱动，可实现高精度的红光、红外光 AC/DC 谱线数据采集)
3. **ArduinoWebsockets** (由 Gil Maimon 编写的轻量高能 Websocket 客户端库，支持 WSS/WS 与 ESP32 连接)
4. **ArduinoJson** (由 Benoit Blanchon 开发的 JSON 高效解析打包库，用于格式化遥测数据发送)

---

## 3. 配置与编译步骤 (Compilation Setup)

1. 打开 [Arduino IDE](https://www.arduino.cc/en/software)。
2. 进入 **首选项 -> 附加开发板管理器网址**，填入 ESP32 官方源：
   ```text
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. 在 **开发板管理器** 中搜索 `esp32` 并安装最新版本。
4. 将开发板选择为 **ESP32S3 Dev Module**。
5. 打开本目录下的 `esp32_bio_sensor.ino`。
6. 修改固件开头的配置项：
   ```cpp
   const char* ssid = "您的Wi-Fi名称";
   const char* password = "您的Wi-Fi密码";
   const char* ws_server_url = "ws://您的服务器IP:3000/ws/device";
   ```
7. 点击 **上传 (Upload)** 编译并烧录固件到您的 ESP32-S3 板子。
8. 烧录成功后，打开串口监视器 (波特率 `115200`) 即可观察传感器初始化及与网关握手连接的日志。

---

## 4. 固件内部核心算法逻辑

- **均值平滑滤波**: 为应对 AD8232 心电信号中常见的工频干扰（50Hz/60Hz）和体动伪影，内置了 $O(1)$ 时间复杂度的 FIFO 环形数组滚动均值滤波器，保留基波信号。
- **自适应峰值阈值触发**: 通过高通滤波提取特征并根据历史幅值设定滑动触点，在心跳去极化（R波）发生时准确锁定时间点，动态反馈至 **绿色 LED** 闪烁。
- **微西门子电导转换**: 对 GSR 信号采用分压反算电阻值，进而计算倒数转换为微西门子（$\mu S$）。当交感神经由于兴奋、说谎、惊恐而加速汗腺分泌时，GSR 电导率会瞬间阶跃。
- **SDNN 时间域算法**: 累加保存最近 10 次心率 R-R 间期差，实时计算标准偏差（SDNN），提供精确的 HRV 指数。
- **仿真注入机制**: 即使传感器未连接（或仅处于极客开发阶段），固件支持解析来自 WebSocket 的偏置事件指令，对内部模拟 ADC 引脚信号附加不同规律的偏移，配合前端的事件模拟演示。
