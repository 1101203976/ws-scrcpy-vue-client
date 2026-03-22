<template>
  <div id="app">
    <DeviceList
      :devices="devices"
      :loading="loading"
      :connected="connected"
      :server-addr="serverAddr"
      @refresh="connectToServer"
    />
  </div>
</template>

<script>
import DeviceList from './components/DeviceList.vue'
import { Multiplexer } from './services/Multiplexer'

// Channel codes from ws-scrcpy
const ChannelCode = {
  HSTS: 'HSTS', // Hosts list
  GTRC: 'GTRC', // Google device tracker
}

export default {
  name: 'App',
  components: {
    DeviceList
  },
  data() {
    const urlParams = new URLSearchParams(location.search)
    return {
      devices: [],
      serverAddr: urlParams.get('server') || '0.0.0.0:8000',
      loading: false,
      connected: false,
      multiplexer: null,
      hostChannel: null,
      deviceChannel: null
    }
  },
  mounted() {
    this.connectToServer()
  },
  beforeDestroy() {
    this.cleanup()
  },
  methods: {
    cleanup() {
      if (this.hostChannel) {
        this.hostChannel.close()
        this.hostChannel = null
      }
      if (this.deviceChannel) {
        this.deviceChannel.close()
        this.deviceChannel = null
      }
      if (this.multiplexer) {
        this.multiplexer.close()
        this.multiplexer = null
      }
    },
    
    async connectToServer() {
      this.cleanup()
      this.loading = true
      this.connected = false
      this.devices = []

      try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//${this.serverAddr}/?action=multiplex`

        const ws = new WebSocket(wsUrl)

        await new Promise((resolve, reject) => {
          ws.onopen = resolve
          ws.onerror = reject
          ws.onclose = () => reject(new Error('Connection closed'))
        })

        this.multiplexer = Multiplexer.wrap(ws)

        const hostData = this.createChannelData(ChannelCode.HSTS)
        this.hostChannel = this.multiplexer.createChannel(hostData)

        this.hostChannel.onmessage = (event) => {
          this.handleHostMessage(event.data)
        }

        this.hostChannel.onclose = () => {
          console.log('Host channel closed')
        }

        this.connected = true
      } catch (error) {
        console.error('Failed to connect:', error)
        this.connected = false
      } finally {
        this.loading = false
      }
    },
    
    createChannelData(code) {
      const buffer = new ArrayBuffer(4)
      const view = new Uint8Array(buffer)
      for (let i = 0; i < code.length; i++) {
        view[i] = code.charCodeAt(i)
      }
      return buffer
    },
    
    handleHostMessage(data) {
      try {
        const message = JSON.parse(data)
        console.log('Host message:', message)
        
        if (message.type === 'hosts') {
          // 启动设备追踪器
          if (message.data.local) {
            message.data.local.forEach(host => {
              if (host.type === 'android') {
                this.startDeviceTracker()
              }
            })
          }
        }
      } catch (error) {
        console.error('Failed to parse host message:', error)
      }
    },
    
    startDeviceTracker() {
      if (this.deviceChannel) {
        return
      }
      
      const deviceData = this.createChannelData(ChannelCode.GTRC)
      this.deviceChannel = this.multiplexer.createChannel(deviceData)
      
      this.deviceChannel.onmessage = (event) => {
        this.handleDeviceMessage(event.data)
      }
      
      this.deviceChannel.onclose = () => {
        console.log('Device channel closed')
        this.deviceChannel = null
      }
    },
    
    handleDeviceMessage(data) {
      try {
        const message = JSON.parse(data)
        console.log('Device message:', message)
        
        if (message.type === 'devicelist') {
          this.devices = message.data.list || []
        } else if (message.type === 'device') {
          // 更新单个设备
          const device = message.data.device
          const index = this.devices.findIndex(d => d.udid === device.udid)
          if (index !== -1) {
            this.$set(this.devices, index, device)
          } else {
            this.devices.push(device)
          }
        }
      } catch (error) {
        console.error('Failed to parse device message:', error)
      }
    }
  }
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%);
  min-height: 100vh;
  color: #e0e0e0;
}

#app {
  min-height: 100vh;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
