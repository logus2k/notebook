import { AgentClient } from './AgentClient.js';
import { AudioResampler } from './AudioResampler.js';

const AGENT_URL = 'https://logus2k.com/llm';
const STT_URL = 'https://logus2k.com/stt';
const STT_PATH = '/stt/socket.io';
const TTS_URL = 'https://logus2k.com/tts';
const TTS_PATH = '/tts/socket.io';
const AGENT_NAME = 'docbro';

/**
 * ChatService - Wires ChatPanel to AgentClient with STT and TTS support.
 */
export class ChatService {

    constructor(chatPanel) {
        this.chatPanel = chatPanel;
        this.agentClient = null;
        this.clientId = crypto.randomUUID();
        this.threadId = crypto.randomUUID();
        this._streamBuffer = '';

        // Voice state
        this.voiceActive = false;
        this._audioContext = null;
        this._mediaStream = null;
        this._workletNode = null;
        this._resampler = null;
        this._sttSocket = null;

        // TTS state
        this._ttsSocket = null;
        this._ttsAudioContext = null;
        this._ttsPlayQueue = Promise.resolve();
        this.ttsEnabled = false;

        this._wirePanel();
    }

    _wirePanel() {
        this.chatPanel.onSend((text) => this.sendMessage(text));
        this.chatPanel.onSttToggle((active) => {
            if (active) this.startVoice();
            else this.stopVoice();
        });
        this.chatPanel.onTtsToggle(() => {
            if (this.ttsEnabled) this.disableTTS();
            else this.enableTTS();
        });
    }

    async connect() {
        this.agentClient = new AgentClient({ url: AGENT_URL });
        await this.agentClient.connect({
            onReconnect: () => {
                console.log('[ChatService] Agent reconnected');
            },
        });

        // STT transcripts
        this.agentClient.onTranscripts({
            onFinal: (payload) => {
                this.chatPanel.addMessage('user', payload.text);
            },
        });

        // LLM streaming responses
        this.agentClient.onStream({
            onStarted: () => {
                this._streamBuffer = '';
                this.chatPanel.setLoading(true);
            },
            onText: (fullText) => {
                this._streamBuffer = fullText;
            },
            onDone: () => {
                this.chatPanel.setLoading(false);
                if (this._streamBuffer) {
                    this.chatPanel.addMessage('assistant', this._streamBuffer);
                }
                this._streamBuffer = '';
            },
            onError: (err) => {
                this.chatPanel.setLoading(false);
                this.chatPanel.addMessage('assistant', `Error: ${err.message}`);
                this._streamBuffer = '';
            },
        });

        console.log('[ChatService] Connected to agent server');
    }

    // --- Text chat ---

    async sendMessage(text) {
        if (!this.agentClient) return;
        this.chatPanel.setLoading(true);
        try {
            await this.agentClient.runText(text, {
                agent: AGENT_NAME,
                threadId: this.threadId,
            });
        } catch (err) {
            this.chatPanel.setLoading(false);
            this.chatPanel.addMessage('assistant', `Error: ${err.message}`);
        }
    }

    // --- Voice (STT) ---

    async startVoice() {
        try {
            this._mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true },
            });

            this._audioContext = new AudioContext({ sampleRate: 48000 });
            await this._audioContext.audioWorklet.addModule('static/js/recorder_worklet.js');

            const source = this._audioContext.createMediaStreamSource(this._mediaStream);
            this._workletNode = new AudioWorkletNode(this._audioContext, 'recorder-worklet');
            this._resampler = new AudioResampler(48000, 16000);

            // Connect STT socket
            const sttOrigin = new URL(STT_URL, window.location.origin).origin;
            this._sttSocket = io(sttOrigin, {
                path: STT_PATH,
                transports: ['websocket', 'polling'],
                forceNew: true,
                query: { client_id: this.clientId },
            });

            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('STT connection timeout')), 10000);
                this._sttSocket.once('connect', () => { clearTimeout(timeout); resolve(); });
                this._sttSocket.once('connect_error', (err) => { clearTimeout(timeout); reject(err); });
            });

            // Packetize and send audio (~100ms chunks)
            let pending = [];
            let pendingLength = 0;
            const sampleRate = this._audioContext.sampleRate;
            const samplesPerPacket = Math.round(sampleRate * 0.1);

            this._workletNode.port.onmessage = (event) => {
                const chunk = event.data;
                if (!chunk?.length) return;

                pending.push(chunk);
                pendingLength += chunk.length;

                if (pendingLength >= samplesPerPacket) {
                    const merged = new Float32Array(pendingLength);
                    let offset = 0;
                    for (const part of pending) {
                        merged.set(part, offset);
                        offset += part.length;
                    }
                    pending = [];
                    pendingLength = 0;

                    const pcm16 = this._resampler.pushFloat32(merged);
                    if (pcm16?.length > 0 && this._sttSocket?.connected) {
                        this._sttSocket.emit('audio_data', {
                            clientId: this.clientId,
                            audioData: pcm16.buffer,
                        });
                    }
                }
            };

            source.connect(this._workletNode);
            this._workletNode.connect(this._audioContext.destination);

            // Subscribe agent to STT transcripts
            await this.agentClient.sttSubscribe({
                sttUrl: STT_URL,
                clientId: this.clientId,
                agent: AGENT_NAME,
                threadId: this.threadId,
            });

            this.voiceActive = true;
            console.log('[ChatService] Voice active');

            // Auto-enable TTS for spoken responses
            await this.enableTTS();

        } catch (err) {
            console.error('[ChatService] Voice start failed:', err);
            this.stopVoice();
        }
    }

    async stopVoice() {
        if (this._workletNode) { this._workletNode.disconnect(); this._workletNode = null; }
        if (this._audioContext) { await this._audioContext.close().catch(() => {}); this._audioContext = null; }
        if (this._mediaStream) { this._mediaStream.getTracks().forEach(t => t.stop()); this._mediaStream = null; }
        if (this._resampler) { this._resampler.reset(); this._resampler = null; }
        if (this._sttSocket) { this._sttSocket.disconnect(); this._sttSocket = null; }
        if (this.agentClient && this.clientId) {
            try { await this.agentClient.sttUnsubscribe({ sttUrl: STT_URL, clientId: this.clientId }); } catch {}
        }
        this.voiceActive = false;
        console.log('[ChatService] Voice stopped');
        await this.disableTTS();
    }

    // --- TTS ---

    async enableTTS() {
        if (this.ttsEnabled) return;
        try {
            await this.agentClient.ttsSubscribe({ clientId: this.clientId });

            const ttsOrigin = new URL(TTS_URL, window.location.origin).origin;
            this._ttsSocket = io(ttsOrigin, {
                path: TTS_PATH,
                transports: ['websocket', 'polling'],
                forceNew: true,
                query: { type: 'browser', format: 'binary', main_client_id: this.clientId },
            });

            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('TTS connection timeout')), 10000);
                this._ttsSocket.once('connect', () => { clearTimeout(timeout); resolve(); });
                this._ttsSocket.once('connect_error', (err) => { clearTimeout(timeout); reject(err); });
            });

            await new Promise((resolve) => {
                this._ttsSocket.emit('register_audio_client', {
                    main_client_id: this.clientId,
                    connection_type: 'browser',
                    mode: 'tts',
                }, () => resolve());
            });

            this._ttsSocket.on('tts_audio_chunk', async (evt) => {
                const buf = evt?.audio_buffer;
                if (!buf) return;

                const actx = this._ensureTtsAudioContext();
                let audioBuf;
                try {
                    audioBuf = await actx.decodeAudioData(buf.slice(0));
                } catch (e) {
                    console.warn('[ChatService] TTS decodeAudioData failed:', e);
                    return;
                }

                this._ttsPlayQueue = this._ttsPlayQueue.then(() => {
                    const src = actx.createBufferSource();
                    src.buffer = audioBuf;
                    src.connect(actx.destination);
                    src.start();
                    return new Promise(res => { src.onended = res; });
                });
            });

            this._ttsSocket.on('tts_stop_immediate', () => {
                this._closeTtsAudioContext();
            });

            this.ttsEnabled = true;
            this.chatPanel.setTtsActive(true);
            console.log('[ChatService] TTS enabled');

        } catch (err) {
            console.error('[ChatService] TTS enable failed:', err);
            await this.disableTTS();
        }
    }

    async disableTTS() {
        if (this.agentClient && this.clientId) {
            try { await this.agentClient.ttsUnsubscribe({ clientId: this.clientId }); } catch {}
        }
        if (this._ttsSocket) {
            try { this._ttsSocket.disconnect(); } catch {}
            this._ttsSocket = null;
        }
        this._closeTtsAudioContext();
        this.ttsEnabled = false;
        this.chatPanel.setTtsActive(false);
    }

    _ensureTtsAudioContext() {
        if (!this._ttsAudioContext) {
            this._ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        }
        return this._ttsAudioContext;
    }

    _closeTtsAudioContext() {
        if (this._ttsAudioContext) {
            try { this._ttsAudioContext.close(); } catch {}
            this._ttsAudioContext = null;
        }
        this._ttsPlayQueue = Promise.resolve();
    }

    // --- Cleanup ---

    disconnect() {
        this.stopVoice();
        if (this.agentClient) {
            this.agentClient.disconnect();
            this.agentClient = null;
        }
    }
}
