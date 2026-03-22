<template>
  <div class="device-list-container">
    
    <main class="content">
      <div v-if="loading" class="loading">
        <div class="loading-spinner"></div>
        <span>正在连接服务器...</span>
      </div>
      
      <div v-else-if="!connected" class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor" class="empty-icon">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        <h2>无法连接到服务器</h2>
        <p>请确保 ws-scrcpy 服务正在运行</p>
        <button class="retry-btn" @click="$emit('refresh')">重试连接</button>
      </div>
      
      <div v-else-if="devices.length === 0" class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor" class="empty-icon">
          <path d="M15.5 1h-8C6.12 1 5 2.12 5 3.5v17C5 21.88 6.12 23 7.5 23h8c1.38 0 2.5-1.12 2.5-2.5v-17C18 2.12 16.88 1 15.5 1zm-4 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5-4H7V4h9v14z"/>
        </svg>
        <h2>暂无设备</h2>
        <p>请通过 USB 连接 Android 设备并启用 USB 调试</p>
      </div>
      
      <div v-if="devices.length > 0" class="content-header">
        <select
          class="quality-select"
          :value="videoQuality"
          @change="changeVideoQuality"
        >
          <option
            v-for="option in videoQualityOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
        <button
          type="button"
          class="fullscreen-toggle-btn"
          :title="isFullscreen ? '缩小显示' : '放大显示'"
          @click.stop="toggleFullscreen"
        >
          <svg v-if="!isFullscreen" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 14l-7 7m0 0l-7-7m7 7V3"/>
          </svg>
          <span>{{ isFullscreen ? '缩小' : '放大' }}</span>
        </button>
      </div>
      
      <div v-if="devices.length > 0" class="device-grid" :class="{ 'fullscreen': isFullscreen }">
        <div 
          v-for="device in sortedDevices" 
          :key="device.udid" 
          class="device-card"
          :class="{ 
            active: device.state === 'device', 
            inactive: device.state !== 'device',
            'drag-target': dragTargetUdid === device.udid
          }"
          @dragover="onDragOver"
          @drop="onDrop($event, device)"
          @dragenter="onDragEnter(device)"
        >
          <!-- 1. 顶部：设备名和连接状态 -->
          <div class="device-card-header">
            <div class="device-info" @click="openAliasEdit(device)">
              <h3 class="device-name">
                {{ getDisplayName(device) }}
              </h3>
              <span class="edit-hint">点击修改</span>
            </div>
          </div>

          <!-- 2. 中间：画面 (或离线图标) -->
          <div class="device-body">
            <template v-if="device.state === 'device' && device.pid !== -1">
              <div class="device-stream-wrap">
                <DeviceStream
                  v-if="!expandedDevice || expandedDevice.udid !== device.udid"
                  ref="deviceStreams"
                  :key="device.udid"
                  :device="device"
                  :wsUrl="getStreamUrl(device)"
                  :qualitySettings="getVideoQualitySettings()"
                />
              </div>
            </template>
            <template v-else>
              <div class="device-offline-placeholder">
                <div class="device-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
                  </svg>
                </div>
              </div>
            </template>
          </div>

          <!-- 3. 底部：操作按钮 -->
          <div class="device-card-actions" v-if="device.state === 'device'">
            <!-- 保留的控制按钮 -->
            <button
              type="button"
              class="action-btn icon-btn"
              title="任务"
              @click.stop="sendKeyToDevice(device, 187)"
            >
              <svg viewBox="0 0 48 48" fill="currentColor">
                <path d="M12.8 12.8h-3.2v25.6h3.2V12.8zm0-3.2c-1.8 0-3.2 1.4-3.2 3.2v25.6c0 1.8 1.4 3.2 3.2 3.2h22.4c1.8 0 3.2-1.4 3.2-3.2V12.8c0-1.8-1.4-3.2-3.2-3.2H12.8z m22.4 25.6H12.8V12.8h22.4v25.6z" />
              </svg>
            </button>
            <button
              type="button"
              class="action-btn icon-btn"
              title="主页"
              @click.stop="sendKeyToDevice(device, 3)"
            >
              <svg viewBox="0 0 48 48" fill="currentColor">
                <path d="M24 35.2c6.2 0 11.2-5 11.2-11.2S30.2 12.8 24 12.8 12.8 17.8 12.8 24 17.8 35.2 24 35.2zm0 3.2c-8 0-14.4-6.4-14.4-14.4s6.4-14.4 14.4-14.4 14.4 6.4 14.4 14.4-6.4 14.4-14.4 14.4z"/>
              </svg>
            </button>
            <button
              type="button"
              class="action-btn icon-btn"
              title="返回"
              @click.stop="sendKeyToDevice(device, 4)"
            >
              <svg viewBox="0 0 48 48" fill="currentColor">
                <path d="M36.7 10.9L36.7 37.6C36.7 39.4 35.5 40.1 34 39.2L12.1 26C10.6 25 10.6 23.5 12.1 22.6L34 9.4C35.5 8.5 36.7 9.2 36.7 10.9Z"/>
              </svg>
            </button>
          </div>
          <div class="device-card-actions" v-else>
            <!-- 离线状态下的占位或其他操作 -->
            <span class="offline-text">设备未连接</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script>
import DeviceStream from './DeviceStream.vue'

export default {
  name: 'DeviceList',
  components: { DeviceStream },
  data() {
    return {
      isFullscreen: false,
      aliases: {},
      deviceOrder: [],
      dragTargetUdid: null,
      expandedDevice: null,
      videoQuality: 'medium',
      videoQualityOptions: [
        { label: '极低', value: 'ultra-low', bitrate: 256000, maxSize: 320 },
        { label: '超低', value: 'very-low', bitrate: 512000, maxSize: 480 },
        { label: '普清', value: 'low', bitrate: 1000000, maxSize: 720 },
        { label: '高清', value: 'medium', bitrate: 2000000, maxSize: 1080 },
        { label: '超清', value: 'high', bitrate: 8000000, maxSize: 1920 }
      ]
    }
  },
  created() {
    try {
      const rawAliases = localStorage.getItem('web-scrcpy-device-aliases')
      if (rawAliases) this.aliases = { ...this.aliases, ...JSON.parse(rawAliases) }

      const rawOrder = localStorage.getItem('web-scrcpy-device-order')
      if (rawOrder) this.deviceOrder = JSON.parse(rawOrder)

      const rawQuality = localStorage.getItem('web-scrcpy-video-quality')
      if (rawQuality) this.videoQuality = rawQuality
    } catch (e) {}
  },
  computed: {
    sortedDevices() {
      if (!this.devices) return []
      
      // Create a map for quick lookup and to handle duplicates if any
      const tempDevices = [...this.devices]
      
      return tempDevices.sort((a, b) => {
        const indexA = this.deviceOrder.indexOf(a.udid)
        const indexB = this.deviceOrder.indexOf(b.udid)
        
        // If both are in the order list, sort by index
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB
        }
        
        // If only A is in the list, A comes first
        if (indexA !== -1) return -1
        
        // If only B is in the list, B comes first
        if (indexB !== -1) return 1
        
        // If neither, existing stability (or by udid/name if we wanted stable default sort)
        return 0
      })
    }
  },
  props: {
    devices: {
      type: Array,
      default: () => []
    },
    loading: {
      type: Boolean,
      default: false
    },
    connected: {
      type: Boolean,
      default: false
    },
    serverAddr: {
      type: String,
      default: 'localhost:8000'
    }
  },
  methods: {
    getDisplayName(device) {
      const alias = this.aliases[device.udid]
      if (alias && alias.trim()) return alias.trim()
      const name = [device['ro.product.manufacturer'], device['ro.product.model']].filter(Boolean).join(' ').trim()
      return name || device.udid
    },
    openAliasEdit(device) {
      const current = this.getDisplayName(device)
      const value = prompt('设备别名（留空恢复为默认名称）', current)
      if (value === null) return
      const trimmed = value.trim()
      if (trimmed) {
        this.$set(this.aliases, device.udid, trimmed)
      } else {
        this.$delete(this.aliases, device.udid)
      }
      try {
        localStorage.setItem('web-scrcpy-device-aliases', JSON.stringify(this.aliases))
      } catch (e) {}
    },
    getStreamUrl(device) {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const params = new URLSearchParams()
      params.set('action', 'proxy-adb')
      params.set('remote', 'tcp:8886')
      params.set('udid', device.udid)
      return `${protocol}//${this.serverAddr}/?${params.toString()}`
    },
    getVideoQualitySettings() {
      const option = this.videoQualityOptions.find(o => o.value === this.videoQuality)
      return option || this.videoQualityOptions[1]
    },
    changeVideoQuality(event) {
      this.videoQuality = event.target.value
      try {
        localStorage.setItem('web-scrcpy-video-quality', this.videoQuality)
      } catch (e) {}

      if (this.$refs.deviceStreams) {
        const streams = Array.isArray(this.$refs.deviceStreams) ? this.$refs.deviceStreams : [this.$refs.deviceStreams]
        streams.forEach(stream => {
          if (stream && stream.reconnect) {
            stream.reconnect()
          }
        })
      }

      if (this.expandedDevice && this.$refs.expandedStream && this.$refs.expandedStream.reconnect) {
        this.$refs.expandedStream.reconnect()
      }
    },
    // Drag and Drop Logic
    onDragStart(event, device) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', device.udid)
      // Optional: set custom drag image if needed
    },
    onDragOver(event) {
      // Allow drop
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    },
    onDragEnter(device) {
       this.dragTargetUdid = device.udid
    },
    onDragEnd() {
      this.dragTargetUdid = null
    },
    onDrop(event, targetDevice) {
      event.preventDefault()
      const draggedUdid = event.dataTransfer.getData('text/plain')
      this.dragTargetUdid = null
      
      if (!draggedUdid || draggedUdid === targetDevice.udid) return
      
      // Update order
      // First, ensure all current devices are in the order list (append new ones)
      const currentUdids = this.devices.map(d => d.udid)
      const knownUdids = new Set(this.deviceOrder)
      
      // Add unknown devices to the end of deviceOrder temporarily
      for (const udid of currentUdids) {
        if (!knownUdids.has(udid)) {
          this.deviceOrder.push(udid)
        }
      }
      
      // Clean up order list: Remove items not in current device list
      // (Optional: keep them if we want to remember history. Let's keep them for now, but focus on reordering)
      
      const oldIndex = this.deviceOrder.indexOf(draggedUdid)
      const newIndex = this.deviceOrder.indexOf(targetDevice.udid)
      
      if (oldIndex === -1 || newIndex === -1) return
      
      // Move item
      this.deviceOrder.splice(oldIndex, 1) // Remove from old (index might shift if we insert before it, but we have strict index)
                                           // actually splice modifies in place. 
                                           // To be safe: remove then insert.
      
      // If we move from left to right (old < new), the insertion index needs adjustment?
      // Actually simpler: remove item, then insert at index of target.
      // But we need to know if we drop BEFORE or AFTER?
      // Standard list reorder usually behaves like "insert before target".
      // Let's implement insert at newIndex.
      
      this.deviceOrder.splice(newIndex, 0, draggedUdid)
      
      this.saveOrder()
    },
    saveOrder() {
      try {
        localStorage.setItem('web-scrcpy-device-order', JSON.stringify(this.deviceOrder))
      } catch (e) {}
    },
    sendKeyToDevice(device, keycode) {
      if (this.expandedDevice && this.expandedDevice.udid === device.udid) {
        const stream = this.$refs.expandedStream
        if (stream) {
           stream.sendKey(keycode)
           return
        }
      }

      if (this.$refs.deviceStreams) {
        const streams = Array.isArray(this.$refs.deviceStreams) ? this.$refs.deviceStreams : [this.$refs.deviceStreams]
        const stream = streams.find(s => s.device && s.device.udid === device.udid)
        if (stream) {
          stream.sendKey(keycode)
        }
      }
    },
    rebootDevice(device) {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const params = new URLSearchParams()
      params.set('action', 'multiplex') // Use multiplex action
      params.set('udid', device.udid)
      const url = `${protocol}//${this.serverAddr}/?${params.toString()}`

      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer' // Important for receiving/sending binary

      const createMessage = (type, channelId, data) => {
        const dataBuf = data ? (typeof data === 'string' ? new TextEncoder().encode(data) : data) : new Uint8Array(0)
        const len = 5 + dataBuf.byteLength
        const buf = new ArrayBuffer(len)
        const view = new DataView(buf)
        view.setUint8(0, type)
        view.setUint32(1, channelId, true) // Little Endian
        new Uint8Array(buf).set(new Uint8Array(dataBuf.buffer || dataBuf), 5)
        return buf
      }

      const CHANNEL_ID = 1
      const MSG_TYPE_CREATE_CHANNEL = 4
      const MSG_TYPE_RAW_STRING_DATA = 32

      ws.onopen = () => {
        console.log('[Reboot] WebSocket connected (multiplex)')
        
        try {
          // 1. Create Channel with SHEL code
          // "SHEL" -> 0x53 0x48 0x45 0x4C
          const shelCode = new Uint8Array([0x53, 0x48, 0x45, 0x4C])
          ws.send(createMessage(MSG_TYPE_CREATE_CHANNEL, CHANNEL_ID, shelCode))
          console.log('[Reboot] Channel created (SHEL)')

          // 2. Send Start Command (JSON)
          const startCmd = JSON.stringify({
            id: 1, 
            type: 'shell', 
            data: {
              type: 'start',
              rows: 24,
              cols: 80,
              udid: device.udid
            }
          })
          ws.send(createMessage(MSG_TYPE_RAW_STRING_DATA, CHANNEL_ID, startCmd))
          console.log('[Reboot] Start command sent')

          // 3. Send Reboot Command
          // Delay slightly to ensure shell is initialized
          setTimeout(() => {
            ws.send(createMessage(MSG_TYPE_RAW_STRING_DATA, CHANNEL_ID, 'reboot\n'))
            console.log('[Reboot] Reboot command sent')

            // Close after sending
            setTimeout(() => {
              ws.close()
              console.log('[Reboot] Closing connection')
            }, 1000)
          }, 500)

        } catch (e) {
          console.error('[Reboot] Error sending commands:', e)
          alert('发送指令出错')
        }
      }

      ws.onclose = (event) => {
        console.log(`[Reboot] WebSocket closed: ${event.code} ${event.reason}`)
      }

      ws.onerror = (err) => {
        console.error('[Reboot] WebSocket error:', err)
        alert('发送重启命令失败')
      }
    },
    async runControlCommand(device, type, additionalData = {}) {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const params = new URLSearchParams()
      params.set('action', 'multiplex')
      const url = `${protocol}//${this.serverAddr}/?${params.toString()}`

      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'

      const createMessage = (msgType, channelId, data) => {
        const dataBuf = data ? (typeof data === 'string' ? new TextEncoder().encode(data) : data) : new Uint8Array(0)
        const len = 5 + dataBuf.byteLength
        const buf = new ArrayBuffer(len)
        const view = new DataView(buf)
        view.setUint8(0, msgType)
        view.setUint32(1, channelId, true)
        new Uint8Array(buf).set(new Uint8Array(dataBuf.buffer || dataBuf), 5)
        return buf
      }

      const CHANNEL_ID = 1
      const MSG_TYPE_CREATE_CHANNEL = 4
      const MSG_TYPE_RAW_STRING_DATA = 32

      return new Promise((resolve, reject) => {
        ws.onopen = () => {
          try {
            // GTRC -> 0x47 0x54 0x52 0x43
            const gtrcCode = new Uint8Array([0x47, 0x54, 0x52, 0x43])
            ws.send(createMessage(MSG_TYPE_CREATE_CHANNEL, CHANNEL_ID, gtrcCode))

            const command = JSON.stringify({
              id: Date.now(),
              type: type,
              data: {
                udid: device.udid,
                ...additionalData
              }
            })
            ws.send(createMessage(MSG_TYPE_RAW_STRING_DATA, CHANNEL_ID, command))
            
            setTimeout(() => {
              ws.close()
              resolve()
            }, 500)
          } catch (e) {
            ws.close()
            reject(e)
          }
        }
        ws.onerror = (err) => {
          reject(err)
        }
      })
    },
    async killServer(device) {
      if (device.pid === -1) {
        alert('Server 未运行')
        return
      }
      try {
        await this.runControlCommand(device, 'kill_server', { pid: device.pid })
        console.log('[Control] Kill server command sent')
      } catch (e) {
        console.error('[Control] Failed to kill server:', e)
        alert('停止 Server 失败')
      }
    },
    async startServer(device) {
      try {
        await this.runControlCommand(device, 'start_server')
        console.log('[Control] Start server command sent')
      } catch (e) {
        console.error('[Control] Failed to start server:', e)
        alert('启动 Server 失败')
        throw e
      }
    },
    async reconnectServer(device) {
      try {
        if (device.pid !== -1) {
          await this.killServer(device)
          // Wait a bit to ensure server is killed
          await new Promise(resolve => setTimeout(resolve, 500))
        }
        await this.startServer(device)
        console.log('[Control] Reconnect successful')
      } catch (e) {
        console.error('[Control] Reconnect failed:', e)
      }
    },
    toggleFullscreen() {
      this.isFullscreen = !this.isFullscreen
      setTimeout(() => {
        if (this.$refs.deviceStreams) {
          const streams = Array.isArray(this.$refs.deviceStreams) ? this.$refs.deviceStreams : [this.$refs.deviceStreams]
          streams.forEach(stream => {
            if (stream && stream.handleResize) {
              stream.handleResize()
            }
          })
        }
      }, 1000)
    }
  }
}
</script>

<style scoped>
.device-list-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
}

.content-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding: 0 12px;
}

.quality-select {
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(0, 212, 170, 0.1);
  color: #00d4aa;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  transition: all 0.2s ease;
}

.quality-select:hover {
  background: rgba(0, 212, 170, 0.2);
  border-color: rgba(0, 212, 170, 0.3);
}

.quality-select:focus {
  border-color: #00d4aa;
  box-shadow: 0 0 0 2px rgba(0, 212, 170, 0.2);
}

.quality-select option {
  background: #1a1a2e;
  color: #fff;
}

.fullscreen-toggle-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: rgba(0, 212, 170, 0.1);
  color: #00d4aa;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.fullscreen-toggle-btn:hover {
  background: rgba(0, 212, 170, 0.2);
  border-color: rgba(0, 212, 170, 0.3);
}

.fullscreen-toggle-btn svg {
  width: 16px;
  height: 16px;
}

.loading, .empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #00d4aa;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading span {
  color: rgba(255, 255, 255, 0.6);
  font-size: 16px;
}

.empty-icon {
  width: 80px;
  height: 80px;
  color: rgba(255, 255, 255, 0.2);
}

.empty-state h2 {
  font-size: 24px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
}

.empty-state p {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.5);
}

.retry-btn {
  margin-top: 20px;
  padding: 12px 28px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #00d4aa 0%, #00a3ff 100%);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.retry-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 212, 170, 0.3);
}

.device-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 12px;
  transition: all 0.5s ease;
}

/* 全屏模式下的设备网格 */
.device-grid.fullscreen {
  grid-template-columns: 1fr;
  gap: 24px;
}

.device-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  overflow: hidden;
  transition: all 0.5s ease;
  position: relative;
  display: flex;
  flex-direction: column;
}

/* 全屏模式下的设备卡片 */
.device-grid.fullscreen .device-card {
  min-height: 700px;
}

.device-grid.fullscreen .device-card-header {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.device-grid.fullscreen .device-body {
  flex: 1;
  background: #000;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 600px;
}

.device-grid.fullscreen .device-card-actions {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.device-grid.fullscreen .device-name {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-grid.fullscreen .action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.device-grid.fullscreen .icon-btn {
  padding: 8px;
}

.device-grid.fullscreen .icon-btn svg {
  width: 20px;
  height: 20px;
}

/* 确保视频内容充满容器 */
.device-grid.fullscreen .device-stream-wrap {
  width: 100%;
  height: 100%;
  flex: 1;
}

.device-grid.fullscreen .device-stream-wrap .stream-inline {
  width: 100%;
  height: 100%;
  min-height: 400px;
}

.device-grid.fullscreen .device-stream-wrap .video-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.device-grid.fullscreen .device-stream-wrap .video-canvas {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.device-card-header {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.device-body {
  flex: 1;
  background: #000;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 180px; /* 减小高度以适应小窗口 */
  transition: all 0.5s ease;
}

.device-stream-wrap {
  width: 100%;
  height: 100%;
  flex: 1;
  position: relative;
}

.device-stream-wrap.expanded {
  width: 100%;
  height: 100%;
}

.device-offline-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 180px;
  color: rgba(255, 255, 255, 0.2);
}

.device-card-actions {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.action-btn span {
  white-space: nowrap;
}

.expand-btn {
  background: rgba(0, 212, 170, 0.1);
  color: #00d4aa;
  padding: 6px; /* Tighter padding for icon */
}

.expand-btn:hover {
  background: rgba(0, 212, 170, 0.2);
  border-color: rgba(0, 212, 170, 0.3);
}

.expand-btn svg {
  width: 16px;
  height: 16px;
}

.icon-btn {
  padding: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.icon-btn svg {
  width: 16px;
  height: 16px;
}

.reboot-btn {
  background: rgba(255, 71, 87, 0.1);
  color: #ff4757;
  padding: 6px;
}

.reboot-btn:hover {
  background: rgba(255, 71, 87, 0.2);
  border-color: rgba(255, 71, 87, 0.3);
}

.reboot-btn svg {
  width: 16px;
  height: 16px;
}

.reconnect-btn-mini {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: rgba(0, 212, 170, 0.1);
  color: #00d4aa;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.reconnect-btn-mini:hover {
  background: rgba(0, 212, 170, 0.2);
  border-color: rgba(0, 212, 170, 0.3);
}

.reconnect-btn-mini svg {
  width: 14px;
  height: 14px;
}

.offline-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.3);
}

.device-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.edit-hint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

/* Rest of reusable styles */
.device-name {
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.alias-btn:hover {
  color: #00d4aa;
}

.status-badge {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.status-badge.device {
  background: rgba(0, 212, 170, 0.15);
  color: #00d4aa;
}

.status-badge.offline {
  background: rgba(255, 71, 87, 0.15);
  color: #ff4757;
}

.status-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drag-handle {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.3);
  margin-right: 8px;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
}

.drag-handle svg {
  width: 20px;
  height: 20px;
}

.drag-handle:active {
  cursor: grabbing;
}

.device-card:hover .drag-handle {
  color: rgba(255, 255, 255, 0.6);
}

.device-card.drag-target {
  border-color: #00d4aa;
  box-shadow: 0 0 0 2px rgba(0, 212, 170, 0.3);
  transform: scale(1.02);
}
</style>
