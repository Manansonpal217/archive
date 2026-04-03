const WebSocket = require('ws');
const { BrowserWindow } = require('electron');
const { getAssemblyApiKey } = require('../storage');

// Transcription session management
let systemAudioTranscription = null;
let micAudioTranscription = null;
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

// Create a WebSocket connection to AssemblyAI for real-time transcription
function createTranscriptionStream(audioSource = 'system') {
    // Ensure storage is initialized
    const storage = require('../storage');
    storage.initializeStorage();
    
    const apiKey = getAssemblyApiKey();
    if (!apiKey) {
        console.error('AssemblyAI API key not configured. Please set it via storage:set-assembly-api-key');
        console.error('Current credentials:', JSON.stringify(storage.getCredentials()));
        return null;
    }
    
    console.log(`Starting AssemblyAI transcription for ${audioSource} audio (key: ${apiKey.substring(0, 8)}...)`);

    // AssemblyAI Universal Streaming endpoint (v3)
    const wsUrl = 'wss://streaming.assemblyai.com/v3/ws?sample_rate=16000';
    
    const ws = new WebSocket(wsUrl, {
        headers: {
            Authorization: apiKey
        }
    });

    let sessionId = null;
    let isFinal = false;
    let currentTranscript = '';
    let audioQueue = []; // Queue audio chunks during connection
    let isConnected = false;
    let lastPartialTranscript = '';
    let partialTranscriptTimeout = null;

    ws.on('open', () => {
        console.log(`AssemblyAI ${audioSource} transcription stream connected`);
        isConnected = true;
        
        // Send any queued audio chunks
        if (audioQueue.length > 0) {
            console.log(`Sending ${audioQueue.length} queued audio chunks for ${audioSource}`);
            audioQueue.forEach(chunk => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(chunk, { binary: true });
                }
            });
            audioQueue = [];
        }
        
        sendToRenderer('transcription-status', {
            source: audioSource,
            status: 'connected',
            message: `Transcription active for ${audioSource} audio`
        });
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            const msgType = message.type || message.message_type;
            
            if (msgType === 'SessionBegins' || msgType === 'SessionCreated' || msgType === 'Begin') {
                sessionId = message.session_id || message.id;
                console.log(`AssemblyAI session started: ${sessionId} (${audioSource})`);
                isConnected = true; // Mark as connected when Begin message received
            } else if (msgType === 'Turn') {
                // Turn message - Universal Streaming API uses this for both partial and final
                const transcript = message.transcript || message.text || '';
                const isFormatted = message.turn_is_formatted === true;
                
                if (transcript && transcript.trim()) {
                    if (isFormatted) {
                        // Final transcript (complete and formatted)
                        currentTranscript = transcript;
                        isFinal = true;
                        
                        console.log(`✅ [${audioSource.toUpperCase()}] Final Turn: "${transcript}"`);
                        
                        sendToRenderer('transcription-final', {
                            source: audioSource,
                            text: transcript,
                            timestamp: message.audio_start || message.created || Date.now()
                        });

                        // Send to text message handler for AI processing
                        sendToRenderer('transcription-ready', {
                            source: audioSource,
                            text: transcript
                        });
                    } else {
                        // Partial transcript (still being processed)
                        console.log(`🔄 [${audioSource}] Partial Turn: "${transcript}"`);
                        lastPartialTranscript = transcript;
                        
                        // Clear existing timeout
                        if (partialTranscriptTimeout) {
                            clearTimeout(partialTranscriptTimeout);
                        }
                        
                        // Send partial to UI
                        sendToRenderer('transcription-partial', {
                            source: audioSource,
                            text: transcript,
                            timestamp: message.audio_start || message.created || Date.now()
                        });
                        
                        // If transcript hasn't changed for 2 seconds, treat it as final and send to Ollama
                        // This handles cases where turn_is_formatted never becomes true
                        partialTranscriptTimeout = setTimeout(() => {
                            if (lastPartialTranscript === transcript && transcript.trim()) {
                                console.log(`⏱️ [${audioSource}] Transcript stabilized, sending to Ollama: "${transcript}"`);
                                
                                // Send as final transcript
                                sendToRenderer('transcription-final', {
                                    source: audioSource,
                                    text: transcript,
                                    timestamp: Date.now()
                                });
                                
                                // Send to Ollama
                                sendToRenderer('transcription-ready', {
                                    source: audioSource,
                                    text: transcript
                                });
                                
                                lastPartialTranscript = ''; // Clear to avoid duplicates
                            }
                        }, 2000); // 2 second delay
                    }
                }
            } else if (msgType === 'PartialTranscript' || msgType === 'Partial') {
                // Partial transcript (still being processed)
                const transcript = message.transcript || message.text || '';
                if (transcript && transcript.trim()) {
                    console.log(`🔄 [${audioSource}] Partial: "${transcript}"`);
                    sendToRenderer('transcription-partial', {
                        source: audioSource,
                        text: transcript,
                        timestamp: message.audio_start || message.created || Date.now()
                    });
                }
            } else if (msgType === 'FinalTranscript' || msgType === 'Final') {
                // Final transcript (complete)
                const transcript = message.transcript || message.text || '';
                if (transcript && transcript.trim()) {
                    currentTranscript = transcript;
                    isFinal = true;
                    
                    console.log(`✅ [${audioSource.toUpperCase()}] Final: "${transcript}"`);
                    
                    sendToRenderer('transcription-final', {
                        source: audioSource,
                        text: transcript,
                        timestamp: message.audio_start || message.created || Date.now()
                    });

                    // Send to text message handler for AI processing
                    sendToRenderer('transcription-ready', {
                        source: audioSource,
                        text: transcript
                    });
                }
            } else if (msgType === 'SessionTerminated' || msgType === 'Termination') {
                console.log(`AssemblyAI session terminated: ${sessionId} (${audioSource})`);
                sendToRenderer('transcription-status', {
                    source: audioSource,
                    status: 'disconnected',
                    message: `Transcription stopped for ${audioSource} audio`
                });
            } else {
                // Log ALL messages for debugging - this will help us see what AssemblyAI is sending
                console.log(`📨 AssemblyAI message (${audioSource}):`, JSON.stringify(message, null, 2));
            }
        } catch (error) {
            console.error(`Error parsing AssemblyAI message (${audioSource}):`, error);
            console.error('Raw message:', data.toString());
        }
    });

    ws.on('error', (error) => {
        console.error(`AssemblyAI WebSocket error (${audioSource}):`, error);
        audioQueue = []; // Clear queue on error
        sendToRenderer('transcription-status', {
            source: audioSource,
            status: 'error',
            message: `Transcription error: ${error.message}`
        });
    });

    ws.on('close', (code, reason) => {
        console.log(`AssemblyAI WebSocket closed (${audioSource}):`, code, reason?.toString());
        sendToRenderer('transcription-status', {
            source: audioSource,
            status: 'disconnected',
            message: `Transcription connection closed for ${audioSource} audio`
        });
    });

    return {
        ws,
        sendAudio: (audioBuffer) => {
            if (ws.readyState === WebSocket.OPEN && isConnected) {
                // Universal Streaming API expects raw PCM audio as binary frames
                // Audio should be 16-bit PCM, mono, 16kHz
                // Verify buffer is not empty and has correct size
                if (audioBuffer.length === 0) {
                    console.warn(`⚠️ Empty audio buffer for ${audioSource}`);
                    return;
                }
                
                // Log first few sends to verify audio is being sent
                if (Math.random() < 0.01) { // Log ~1% of sends to avoid spam
                    console.log(`📤 Sending audio chunk (${audioSource}): ${audioBuffer.length} bytes`);
                }
                
                ws.send(audioBuffer, { binary: true });
            } else if (ws.readyState === WebSocket.CONNECTING || !isConnected) {
                // Queue audio if still connecting - will send once connected
                audioQueue.push(audioBuffer);
                // Limit queue size to prevent memory issues (keep last 50 chunks ~5 seconds at 100ms chunks)
                if (audioQueue.length > 50) {
                    audioQueue.shift(); // Remove oldest chunk
                }
            }
        },
        getStats: () => {
            return {
                connected: isConnected,
                readyState: ws.readyState,
                queueLength: audioQueue.length,
                sessionId: sessionId
            };
        },
        close: () => {
            // Clear any pending timeouts
            if (partialTranscriptTimeout) {
                clearTimeout(partialTranscriptTimeout);
                partialTranscriptTimeout = null;
            }
            
            // Send any pending partial transcript as final before closing
            if (lastPartialTranscript && lastPartialTranscript.trim()) {
                console.log(`📤 [${audioSource}] Sending final transcript before close: "${lastPartialTranscript}"`);
                sendToRenderer('transcription-final', {
                    source: audioSource,
                    text: lastPartialTranscript,
                    timestamp: Date.now()
                });
                sendToRenderer('transcription-ready', {
                    source: audioSource,
                    text: lastPartialTranscript
                });
            }
            
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                // Send termination message (Universal Streaming API format)
                try {
                    ws.send(JSON.stringify({ type: 'CloseStream' }));
                } catch (e) {
                    // Ignore errors when closing
                }
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

module.exports = {
    startSystemAudioTranscription,
    startMicAudioTranscription,
    stopSystemAudioTranscription,
    stopMicAudioTranscription,
    stopAllTranscription,
    processAudioChunk,
    sendToRenderer,
    getSystemAudioTranscription,
    getMicAudioTranscription
};
