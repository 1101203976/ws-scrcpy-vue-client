<template>
  <div class="stream-inline">
    <div class="video-wrapper" ref="videoWrapper">
      <canvas
        ref="canvas"
        class="video-canvas"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseLeave"
        @wheel="handleWheel"
        @touchstart.prevent="handleTouchStart"
        @touchmove.prevent="handleTouchMove"
        @touchend.prevent="handleTouchEnd"
        @touchcancel.prevent="handleTouchEnd"
        @contextmenu.prevent
      ></canvas>
      <div v-if="!streamConnected" class="loading-overlay">
        <div class="loading-spinner"></div>
        <span>{{ statusText }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { StreamReceiver } from "../services/StreamReceiver";
import { TouchHandler } from "../services/TouchHandler";

const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_texture;
  void main() {
    gl_FragColor = texture2D(u_texture, v_texCoord);
  }
`;

export default {
  name: "DeviceStream",
  props: {
    device: {
      type: Object,
      required: true,
    },
    wsUrl: {
      type: String,
      required: true,
    },
    qualitySettings: {
      type: Object,
      default: () => ({ bitrate: 2000000, maxSize: 1080 })
    }
  },
  data() {
    return {
      streamReceiver: null,
      touchHandler: null,
      streamConnected: false,
      statusText: "正在连接...",
      decoder: null,
      gl: null,
      program: null,
      texture: null,
      screenWidth: 0,
      screenHeight: 0,
      cachedCanvasWidth: 0,
      cachedCanvasHeight: 0,
      frameBuffer: null,
      bufferedSPS: false,
      bufferedPPS: false,
      hadIDR: false,
      videoSettingsSent: false,
      currentPts: 0,
      connectionId: 0,
    };
  },
  watch: {
    wsUrl: {
      handler(newUrl, oldUrl) {
        if (newUrl !== oldUrl) {
          console.log('wsUrl changed:', oldUrl, '->', newUrl);
          this.disconnect();
          this.connect();
        }
      }
    },
    qualitySettings: {
      handler(newSettings, oldSettings) {
        if (newSettings && oldSettings && newSettings.value !== oldSettings.value) {
          console.log('Quality changed, reconnecting...')
          this.reconnect()
        }
      },
      deep: true
    }
  },
  mounted() {
    this.initCanvas();
    this.connect();
    window.addEventListener('resize', this.handleResize);
  },
  beforeDestroy() {
    this.disconnect();
    window.removeEventListener('resize', this.handleResize);
  },
  methods: {
    initCanvas() {
      const canvas = this.$refs.canvas;
      if (!canvas) return;

      this.gl = canvas.getContext('webgl', {
        alpha: false,
        desynchronized: true,
        preserveDrawingBuffer: false
      });

      if (!this.gl) {
        console.warn('WebGL not supported, falling back to 2D');
        return;
      }

      const gl = this.gl;

      const vertexShader = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vertexShader, VERTEX_SHADER);
      gl.compileShader(vertexShader);

      const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fragmentShader, FRAGMENT_SHADER);
      gl.compileShader(fragmentShader);

      this.program = gl.createProgram();
      gl.attachShader(this.program, vertexShader);
      gl.attachShader(this.program, fragmentShader);
      gl.linkProgram(this.program);

      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,  1, -1,  -1, 1,
        -1,  1,  1, -1,   1, 1
      ]), gl.STATIC_DRAW);

      const texCoordBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 1,  1, 1,  0, 0,
        0, 0,  1, 1,  1, 0
      ]), gl.STATIC_DRAW);

      gl.useProgram(this.program);

      const positionLoc = gl.getAttribLocation(this.program, 'a_position');
      gl.enableVertexAttribArray(positionLoc);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      const texCoordLoc = gl.getAttribLocation(this.program, 'a_texCoord');
      gl.enableVertexAttribArray(texCoordLoc);
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);

      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    },

    async connect() {
      const currentConnectionId = ++this.connectionId;
      try {
        console.log('Connecting with wsUrl:', this.wsUrl);
        this.statusText = "正在连接...";
        this.initDecoder();
        this.streamReceiver = new StreamReceiver(this.wsUrl);

        this.streamReceiver.on("connected", () => {
          if (this.connectionId !== currentConnectionId) return;
          this.streamConnected = true;
          this.statusText = "已连接";
        });

        this.streamReceiver.on("video", (data) => {
          if (this.connectionId !== currentConnectionId) return;
          this.handleVideoFrame(data);
        });

        this.streamReceiver.on("displayInfo", (info) => {
          if (this.connectionId !== currentConnectionId) return;
          if (info && info.length > 0 && !this.videoSettingsSent) {
            this.videoSettingsSent = true;
            this.sendVideoSettings(info[0]);
          }
        });

        this.streamReceiver.on("disconnected", () => {
          if (this.connectionId !== currentConnectionId) return;
          this.streamConnected = false;
          this.statusText = "连接已断开";
        });

        this.streamReceiver.on("error", () => {
          if (this.connectionId !== currentConnectionId) return;
          this.statusText = "连接出错";
        });

        await this.streamReceiver.connect();

        this.touchHandler = new TouchHandler(this.$refs.canvas, (message) =>
          this.streamReceiver.sendControlMessage(message)
        );
      } catch (error) {
        this.statusText = "连接失败";
      }
    },

    disconnect() {
      if (this.streamReceiver) {
        this.streamReceiver.disconnect();
        this.streamReceiver = null;
      }
      if (this.decoder && this.decoder.state !== "closed") {
        this.decoder.close();
        this.decoder = null;
      }
      if (this.touchHandler) {
        this.touchHandler.destroy();
        this.touchHandler = null;
      }
      if (this.gl) {
        this.gl = null;
        this.program = null;
        this.texture = null;
      }
    },

    reconnect() {
      this.disconnect();
      this.streamConnected = false;
      this.videoSettingsSent = false;
      this.bufferedSPS = false;
      this.bufferedPPS = false;
      this.hadIDR = false;
      this.currentPts = 0;
      this.frameBuffer = null;
      this.cachedCanvasWidth = 0;
      this.cachedCanvasHeight = 0;
      this.$nextTick(() => {
        this.initCanvas();
        this.connect();
      });
    },

    initDecoder() {
      if (typeof VideoDecoder === "undefined") {
        this.statusText = "浏览器不支持 WebCodecs";
        return;
      }
      this.decoder = new VideoDecoder({
        output: (frame) => {
          this.drawFrame(frame);
          frame.close();
        },
        error: () => {},
      });
    },

    handleVideoFrame(data) {
      if (!this.decoder || this.decoder.state === "closed") return;
      const array = new Uint8Array(data);
      if (array.length === 12) {
        const view = new DataView(data);
        this.currentPts = Number(view.getBigInt64(0, false));
        return;
      }
      if (array.length < 5) return;
      if (array[0] !== 0 || array[1] !== 0 || array[2] !== 0 || array[3] !== 1) return;
      const nalType = array[4] & 0x1f;
      const isIDR = nalType === 5;

      if (nalType === 7) {
        const config = this.parseSPS(array.subarray(4));
        if (config) {
          this.screenWidth = config.width;
          this.screenHeight = config.height;
          this.updateCanvasSize(config.width, config.height);
          try {
            this.decoder.configure({ codec: config.codec, optimizeForLatency: true });
          } catch (e) {}
        }
        this.bufferedSPS = true;
        this.addToBuffer(array);
        this.hadIDR = false;
        return;
      }
      if (nalType === 8) {
        this.bufferedPPS = true;
        this.addToBuffer(array);
        return;
      }
      if (nalType === 6) {
        if (this.bufferedSPS && this.bufferedPPS) this.addToBuffer(array);
        return;
      }
      if (isIDR) {
        const combinedArray = this.addToBuffer(array);
        this.hadIDR = true;
        if (this.decoder.state === "configured" && combinedArray) {
          try {
            this.decoder.decode(
              new EncodedVideoChunk({
                type: "key",
                timestamp: this.currentPts || 0,
                data: combinedArray.buffer,
              })
            );
          } catch (e) {}
          this.frameBuffer = null;
          this.bufferedPPS = false;
          this.bufferedSPS = false;
        }
        return;
      }
      if (nalType === 1 && this.hadIDR && this.decoder.state === "configured") {
        try {
          this.decoder.decode(
            new EncodedVideoChunk({
              type: "delta",
              timestamp: this.currentPts || 0,
              data: array.buffer,
            })
          );
        } catch (e) {}
      }
    },

    addToBuffer(data) {
      let array;
      if (this.frameBuffer) {
        array = new Uint8Array(this.frameBuffer.byteLength + data.byteLength);
        array.set(new Uint8Array(this.frameBuffer));
        array.set(new Uint8Array(data), this.frameBuffer.byteLength);
      } else {
        array = data;
      }
      this.frameBuffer = array.buffer;
      return array;
    },

    sendVideoSettings(displayInfo) {
      const TYPE_CHANGE_STREAM_PARAMETERS = 101;
      const bufferLength = 1 + 35;
      const buffer = new ArrayBuffer(bufferLength);
      const view = new DataView(buffer);
      const settings = this.qualitySettings || { bitrate: 2000000, maxSize: 1080 };
      const maxSize = settings.maxSize || 1080;
      const bitrate = settings.bitrate || 2000000;

      let offset = 0;
      view.setUint8(offset, TYPE_CHANGE_STREAM_PARAMETERS);
      offset += 1;
      view.setInt32(offset, Math.round(bitrate / 8), false);
      offset += 4;
      view.setInt32(offset, 24, false);
      offset += 4;
      view.setInt8(offset, 5);
      offset += 1;
      view.setInt16(offset, maxSize, false);
      offset += 2;
      view.setInt16(offset, maxSize, false);
      offset += 2;
      for (let i = 0; i < 4; i++) {
        view.setInt16(offset, 0, false);
        offset += 2;
      }
      view.setInt8(offset, 1);
      offset += 1;
      view.setInt8(offset, -1);
      offset += 1;
      view.setInt32(offset, displayInfo?.displayId || 0, false);
      offset += 4;
      view.setInt32(offset, 0, false);
      offset += 4;
      view.setInt32(offset, 0, false);
      this.streamReceiver.sendControlMessage(buffer);
    },

    parseSPS(data) {
      try {
        const profileIdc = data[1];
        const constraintFlags = data[2];
        const levelIdc = data[3];
        const toHex = (v) => v.toString(16).padStart(2, "0").toUpperCase();
        const codec = `avc1.${toHex(profileIdc)}${toHex(constraintFlags)}${toHex(levelIdc)}`;
        return { codec, width: 1080, height: 1920 };
      } catch (e) {
        return null;
      }
    },

    updateCanvasSize(width, height) {
      if (this.cachedCanvasWidth === width && this.cachedCanvasHeight === height) {
        return;
      }
      const canvas = this.$refs.canvas;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      this.cachedCanvasWidth = width;
      this.cachedCanvasHeight = height;
      if (this.gl) {
        this.gl.viewport(0, 0, width, height);
      }
    },

    drawFrame(frame) {
      if (!this.gl) return;
      const canvas = this.$refs.canvas;
      if (!canvas) return;

      const width = frame.displayWidth;
      const height = frame.displayHeight;

      if (this.cachedCanvasWidth !== width || this.cachedCanvasHeight !== height) {
        canvas.width = width;
        canvas.height = height;
        this.cachedCanvasWidth = width;
        this.cachedCanvasHeight = height;
        this.gl.viewport(0, 0, width, height);
      }

      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },

    handleMouseDown(e) {
      if (this.touchHandler) this.touchHandler.handleMouseEvent(e, "down");
    },
    handleMouseMove(e) {
      if (this.touchHandler) this.touchHandler.handleMouseEvent(e, "move");
    },
    handleMouseUp(e) {
      if (this.touchHandler) this.touchHandler.handleMouseEvent(e, "up");
    },
    handleMouseLeave(e) {
      if (this.touchHandler) this.touchHandler.handleMouseEvent(e, "up");
    },
    handleWheel(e) {
      if (this.touchHandler) this.touchHandler.handleWheelEvent(e);
    },
    handleTouchStart(e) {
      if (this.touchHandler) this.touchHandler.handleTouchEvent(e, "start");
    },
    handleTouchMove(e) {
      if (this.touchHandler) this.touchHandler.handleTouchEvent(e, "move");
    },
    handleTouchEnd(e) {
      if (this.touchHandler) this.touchHandler.handleTouchEvent(e, "end");
    },

    handleResize() {
      const canvas = this.$refs.canvas;
      if (canvas && (canvas.width > 0 && canvas.height > 0)) {
        setTimeout(() => {
          this.updateCanvasSize(canvas.width, canvas.height);
        }, 300);
      }
    },
    sendKey(keycode) {
      if (!this.streamReceiver) return;

      const ACTION_DOWN = 0;
      const ACTION_UP = 1;
      const TYPE_KEYCODE = 0;
      const PAYLOAD_LENGTH = 13;

      const createMsg = (action) => {
        const buffer = new ArrayBuffer(PAYLOAD_LENGTH + 1);
        const view = new DataView(buffer);
        view.setUint8(0, TYPE_KEYCODE);
        view.setUint8(1, action);
        view.setUint32(2, keycode, false);
        view.setUint32(6, 0, false);
        view.setUint32(10, 0, false);
        return buffer;
      };

      this.streamReceiver.sendControlMessage(createMsg(ACTION_DOWN));
      this.streamReceiver.sendControlMessage(createMsg(ACTION_UP));
    },
  },
};
</script>

<style scoped>
.stream-inline {
  width: 100%;
  height: 100%;
  min-height: 200px;
  position: relative;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.3s ease;
}

.video-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-canvas {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  touch-action: none;
  display: block;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 12px;
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: #00d4aa;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-overlay span {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}
</style>