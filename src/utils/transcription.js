const WebSocket = require('ws');
const { BrowserWindow } = require('electron');

const ASSEMBLYAI_API_KEY = '30cd51828bf64f259a369c344c750ce0';

// Transcription session management
let systemAudioTranscription = null;
let micAudioTranscription = null;
/** Single-session realtime ASR used only while PTT button is held (system audio). */
let pttRealtimeSession = null;
let transcriptionCallbacks = [];

// Export state getters
function getSystemAudioTranscription() {
    return systemAudioTranscription;
}

function getMicAudioTranscription() {
    return micAudioTranscription;
}

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

const SILENCE_RMS_THRESHOLD = 150;   // RMS below this = silence (16-bit PCM scale)
const SILENCE_CHUNKS_TO_SEGMENT = 5; // ~500ms silence → finalize current partial into segment buffer

// Calculate RMS energy of a 16-bit PCM buffer
function calculateRMS(buffer) {
    if (buffer.length < 2) return 0;
    const samples = Math.floor(buffer.length / 2);
    let sum = 0;
    for (let i = 0; i < samples; i++) {
        const s = buffer.readInt16LE(i * 2);
        sum += s * s;
    }
    return Math.sqrt(sum / samples);
}

// Create a WebSocket connection to AssemblyAI for real-time transcription
function createTranscriptionStream(audioSource = 'system') {
    console.log(`Starting AssemblyAI transcription for ${audioSource} audio (key: ${ASSEMBLYAI_API_KEY.substring(0, 8)}...)`);

    const wsUrl = 'wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=universal-streaming-english';

    const ws = new WebSocket(wsUrl, {
        headers: { Authorization: ASSEMBLYAI_API_KEY }
    });

    let sessionId = null;
    let audioQueue = [];
    let isConnected = false;
    let consecutiveSilentChunks = 0;

    // Two-stage buffer:
    //  segmentBuffer  — completed partial segments from this speaker turn (not yet sent to AI)
    //  currentPartial — the partial currently being built by AssemblyAI
    let segmentBuffer = [];
    let currentPartial = '';
    let lastSentToAI = '';        // dedup: don't send the same text twice

    function getAccumulated() {
        const parts = [...segmentBuffer];
        if (currentPartial) parts.push(currentPartial);
        return parts.join(' ').trim();
    }

    // Add currentPartial to segmentBuffer and reset it
    function commitCurrentPartial() {
        if (!currentPartial.trim()) return;
        const last = segmentBuffer[segmentBuffer.length - 1];
        if (last !== currentPartial) segmentBuffer.push(currentPartial);
        currentPartial = '';
    }

    // Send the accumulated buffer to AI (called manually via PTT release)
    function dispatchToAI(reason) {
        commitCurrentPartial();
        const text = segmentBuffer.join(' ').trim();
        if (!text || text === lastSentToAI) return;
        lastSentToAI = text;
        segmentBuffer = [];
        console.log(`✅ [${audioSource.toUpperCase()}] ${reason} → AI: "${text}"`);
        sendToRenderer('transcription-final', { source: audioSource, text, timestamp: Date.now() });
        sendToRenderer('transcription-ready', { source: audioSource, text });
    }

    // Reset all buffers so PTT starts fresh each press
    function resetBuffers() {
        segmentBuffer = [];
        currentPartial = '';
        lastSentToAI = '';
        console.log(`🔄 [${audioSource.toUpperCase()}] Buffers reset for PTT`);
    }

    ws.on('open', () => {
        console.log(`AssemblyAI ${audioSource} transcription stream connected`);
        isConnected = true;

        if (audioQueue.length > 0) {
            console.log(`Sending ${audioQueue.length} queued audio chunks for ${audioSource}`);
            audioQueue.forEach(chunk => {
                if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
            });
            audioQueue = [];
        }

        if (audioSource !== 'ptt') {
            sendToRenderer('transcription-status', {
                source: audioSource,
                status: 'connected',
                message: `Transcription active for ${audioSource} audio`
            });
        }
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            const msgType = message.type || message.message_type;

            if (msgType === 'SessionBegins' || msgType === 'SessionCreated' || msgType === 'Begin') {
                sessionId = message.session_id || message.id;
                console.log(`AssemblyAI session started: ${sessionId} (${audioSource})`);
                isConnected = true;

            } else if (msgType === 'Turn') {
                const transcript = (message.transcript || message.text || '').trim();
                const isFormatted = message.turn_is_formatted === true;

                if (!transcript) return;

                consecutiveSilentChunks = 0; // speaker is talking
                currentPartial = transcript;

                // Show the full accumulated picture in the UI
                if (audioSource === 'ptt') {
                    sendToRenderer('ptt-live-transcript', { text: getAccumulated() });
                } else {
                    sendToRenderer('transcription-partial', {
                        source: audioSource,
                        text: getAccumulated(),
                        timestamp: message.audio_start || message.created || Date.now()
                    });
                }

                if (isFormatted) {
                    // AssemblyAI confirmed this sentence is complete — buffer it; PTT release will send to AI
                    commitCurrentPartial();
                    if (audioSource === 'ptt') {
                        sendToRenderer('ptt-live-transcript', { text: getAccumulated() });
                    }
                } else {
                    // Still a partial — just update currentPartial, no auto-flush
                }

            } else if (msgType === 'PartialTranscript' || msgType === 'Partial') {
                const transcript = (message.transcript || message.text || '').trim();
                if (!transcript) return;

                consecutiveSilentChunks = 0;
                currentPartial = transcript;

                if (audioSource === 'ptt') {
                    sendToRenderer('ptt-live-transcript', { text: getAccumulated() });
                } else {
                    sendToRenderer('transcription-partial', {
                        source: audioSource,
                        text: getAccumulated(),
                        timestamp: message.audio_start || message.created || Date.now()
                    });
                }

            } else if (msgType === 'FinalTranscript' || msgType === 'Final') {
                const transcript = (message.transcript || message.text || '').trim();
                if (!transcript) return;
                currentPartial = transcript;
                commitCurrentPartial();
                if (audioSource === 'ptt') {
                    sendToRenderer('ptt-live-transcript', { text: getAccumulated() });
                }

            } else if (msgType === 'SessionTerminated' || msgType === 'Termination') {
                console.log(`AssemblyAI session terminated: ${sessionId} (${audioSource})`);
                if (audioSource !== 'ptt') {
                    sendToRenderer('transcription-status', {
                        source: audioSource,
                        status: 'disconnected',
                        message: `Transcription stopped for ${audioSource} audio`
                    });
                }

            } else if (msgType !== 'Error') {
                console.log(`📨 AssemblyAI message (${audioSource}):`, JSON.stringify(message, null, 2));
            }
        } catch (error) {
            console.error(`Error parsing AssemblyAI message (${audioSource}):`, error);
        }
    });

    ws.on('error', (error) => {
        console.error(`AssemblyAI WebSocket error (${audioSource}):`, error);
        audioQueue = [];
        if (audioSource !== 'ptt') {
            sendToRenderer('transcription-status', {
                source: audioSource,
                status: 'error',
                message: `Transcription error: ${error.message}`
            });
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`AssemblyAI WebSocket closed (${audioSource}):`, code, reason?.toString());
        if (audioSource !== 'ptt') {
            sendToRenderer('transcription-status', {
                source: audioSource,
                status: 'disconnected',
                message: `Transcription connection closed for ${audioSource} audio`
            });
        }
    });

    return {
        ws,
        sendAudio: (audioBuffer) => {
            if (audioBuffer.length === 0) return;

            if (ws.readyState === WebSocket.OPEN && isConnected) {
                const rms = calculateRMS(audioBuffer);

                if (rms < SILENCE_RMS_THRESHOLD) {
                    consecutiveSilentChunks++;
                    // Commit any in-progress partial on silence so it's ready for PTT release
                    if (consecutiveSilentChunks === SILENCE_CHUNKS_TO_SEGMENT && currentPartial) {
                        console.log(`🔇 [${audioSource}] Silence detected, committing partial: "${currentPartial}"`);
                        commitCurrentPartial();
                        if (audioSource === 'ptt') {
                            sendToRenderer('ptt-live-transcript', { text: getAccumulated() });
                        }
                    }
                } else {
                    consecutiveSilentChunks = 0;
                }

                if (Math.random() < 0.005) {
                    console.log(`📤 Audio chunk (${audioSource}): ${audioBuffer.length}B RMS:${Math.round(rms)}`);
                }

                ws.send(audioBuffer, { binary: true });
            } else if (ws.readyState === WebSocket.CONNECTING || !isConnected) {
                audioQueue.push(audioBuffer);
                if (audioQueue.length > 50) audioQueue.shift();
            }
        },
        manualFlush: () => dispatchToAI('PTT release'),
        resetBuffers,
        getAccumulatedText: () => getAccumulated(),
        getStats: () => ({
            connected: isConnected,
            readyState: ws.readyState,
            queueLength: audioQueue.length,
            sessionId
        }),
        close: () => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch (e) {}
                ws.close();
            }
        }
    };
}

// Start transcription for system audio
function startSystemAudioTranscription() {
    if (systemAudioTranscription) {
        console.log('System audio transcription already running');
        return systemAudioTranscription;
    }

    systemAudioTranscription = createTranscriptionStream('system');
    return systemAudioTranscription;
}

// Start transcription for microphone audio
function startMicAudioTranscription() {
    if (micAudioTranscription) {
        console.log('Mic audio transcription already running');
        return micAudioTranscription;
    }

    micAudioTranscription = createTranscriptionStream('mic');
    return micAudioTranscription;
}

// Stop transcription
function stopSystemAudioTranscription() {
    if (systemAudioTranscription) {
        systemAudioTranscription.close();
        systemAudioTranscription = null;
        console.log('System audio transcription stopped');
    }
}

function stopMicAudioTranscription() {
    if (micAudioTranscription) {
        micAudioTranscription.close();
        micAudioTranscription = null;
        console.log('Mic audio transcription stopped');
    }
}

function stopAllTranscription() {
    stopSystemAudioTranscription();
    stopMicAudioTranscription();
}

// Flush mic transcription to AI (called on PTT button release)
function flushMicTranscription() {
    if (micAudioTranscription) {
        micAudioTranscription.manualFlush();
    }
}

// Reset mic transcription buffers (called on PTT button press for a fresh recording)
function resetMicTranscriptionBuffers() {
    if (micAudioTranscription) {
        micAudioTranscription.resetBuffers();
    }
}

// Process audio chunk and send to transcription
function processAudioChunk(audioBuffer, source = 'system') {
    // Resample from 24kHz to 16kHz if needed (AssemblyAI expects 16kHz)
    const resampledBuffer = resampleAudio(audioBuffer, 24000, 16000);
    
    if (source === 'system' && systemAudioTranscription) {
        systemAudioTranscription.sendAudio(resampledBuffer);
    } else if (source === 'mic' && micAudioTranscription) {
        micAudioTranscription.sendAudio(resampledBuffer);
    }
}

// Simple resampling from 24kHz to 16kHz (linear interpolation)
function resampleAudio(inputBuffer, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) {
        return inputBuffer;
    }

    const inputLength = inputBuffer.length / 2; // 16-bit samples
    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.floor(inputLength / ratio);
    const outputBuffer = Buffer.alloc(outputLength * 2);

    for (let i = 0; i < outputLength; i++) {
        const srcIndex = i * ratio;
        const srcIndexFloor = Math.floor(srcIndex);
        const srcIndexCeil = Math.min(srcIndexFloor + 1, inputLength - 1);
        const fraction = srcIndex - srcIndexFloor;

        // Read 16-bit samples
        const sample1 = inputBuffer.readInt16LE(srcIndexFloor * 2);
        const sample2 = inputBuffer.readInt16LE(srcIndexCeil * 2);

        // Linear interpolation
        const interpolated = sample1 + (sample2 - sample1) * fraction;
        outputBuffer.writeInt16LE(Math.round(interpolated), i * 2);
    }

    return outputBuffer;
}

/** Fresh AssemblyAI stream for one PTT press (live captions only). */
function startPTTRealtimeSession() {
    if (pttRealtimeSession) {
        try {
            pttRealtimeSession.close();
        } catch (_) {
            /* ignore */
        }
        pttRealtimeSession = null;
    }
    pttRealtimeSession = createTranscriptionStream('ptt');
}

function feedPTTRealtimeAudio(audioBuffer24kMono) {
    if (!pttRealtimeSession || audioBuffer24kMono.length === 0) return;
    const resampledBuffer = resampleAudio(audioBuffer24kMono, 24000, 16000);
    pttRealtimeSession.sendAudio(resampledBuffer);
}

function stopPTTRealtimeSession() {
    if (!pttRealtimeSession) return;
    try {
        pttRealtimeSession.close();
    } catch (_) {
        /* ignore */
    } finally {
        pttRealtimeSession = null;
    }
}

module.exports = {
    startSystemAudioTranscription,
    startMicAudioTranscription,
    stopSystemAudioTranscription,
    stopMicAudioTranscription,
    stopAllTranscription,
    processAudioChunk,
    flushMicTranscription,
    resetMicTranscriptionBuffers,
    sendToRenderer,
    getSystemAudioTranscription,
    getMicAudioTranscription,
    startPTTRealtimeSession,
    feedPTTRealtimeAudio,
    stopPTTRealtimeSession
};
