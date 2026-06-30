const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio, pcmToWavBuffer } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');
const OpenAI = require('openai');
const { startPTTRealtimeSession, feedPTTRealtimeAudio, stopPTTRealtimeSession } = require('./transcription');

// Hardcoded API keys
const OPENAI_API_KEY = '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';
const OPENAI_MODEL = 'gpt-4o-mini';

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
    timeout: 600000, // 10m — vision requests can be slow; connect phase still bounded by retries
    maxRetries: 3,
});

/** PCM mono chunks @ 24kHz while PTT held (system audio only). */
let pttAudioChunks = [];
let isPTTRecording = false;

/** Drops overlapping vision uploads (e.g. key-repeat on next-step shortcut). */
let sendImageContentLocked = false;

/** Serialize ptt-start / ptt-release so rapid taps cannot reorder IPC. */
let pttChain = Promise.resolve();
function runPttSequential(fn) {
    const next = pttChain.then(fn);
    pttChain = next.catch(() => {});
    return next;
}

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
let conversationHistory = [];
let screenAnalysisHistory = [];
let currentProfile = null;
let currentCustomPrompt = null;
let isInitializingSession = false;

// Conversation context (OpenAI message format)
let conversationContext = [];

function formatSpeakerResults(results) {
    let text = '';
    for (const result of results) {
        if (result.transcript && result.speakerId) {
            const speakerLabel = result.speakerId === 1 ? 'Interviewer' : 'Candidate';
            text += `[${speakerLabel}]: ${result.transcript}\n`;
        }
    }
    return text;
}

module.exports.formatSpeakerResults = formatSpeakerResults;

// Audio capture variables
let systemAudioProc = null;
// messageBuffer removed - no longer needed with text-only API

// Reconnection variables
let isUserClosing = false;
let sessionParams = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000;

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// Build context message for session restoration
function buildContextMessage() {
    const lastTurns = conversationHistory.slice(-20);
    const validTurns = lastTurns.filter(turn => turn.transcription?.trim() && turn.ai_response?.trim());

    if (validTurns.length === 0) return null;

    const contextLines = validTurns.map(turn =>
        `[Interviewer]: ${turn.transcription.trim()}\n[Your answer]: ${turn.ai_response.trim()}`
    );

    return `Session reconnected. Here's the conversation so far:\n\n${contextLines.join('\n\n')}\n\nContinue from here.`;
}


// Conversation management functions
function initializeNewSession(profile = null, customPrompt = null) {
    currentSessionId = Date.now().toString();
    currentTranscription = '';
    conversationHistory = [];
    screenAnalysisHistory = [];
    currentProfile = profile;
    currentCustomPrompt = customPrompt;
    console.log('New conversation session started:', currentSessionId, 'profile:', profile);

    // Save initial session with profile context
    if (profile) {
        sendToRenderer('save-session-context', {
            sessionId: currentSessionId,
            profile: profile,
            customPrompt: customPrompt || ''
        });
    }
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    console.log('Saved conversation turn:', conversationTurn);

    // Send to renderer to save in IndexedDB
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function saveScreenAnalysis(prompt, response, model) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const analysisEntry = {
        timestamp: Date.now(),
        prompt: prompt,
        response: response.trim(),
        model: model
    };

    screenAnalysisHistory.push(analysisEntry);
    console.log('Saved screen analysis:', analysisEntry);

    // Send to renderer to save
    sendToRenderer('save-screen-analysis', {
        sessionId: currentSessionId,
        analysis: analysisEntry,
        fullHistory: screenAnalysisHistory,
        profile: currentProfile,
        customPrompt: currentCustomPrompt
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

async function getEnabledTools() {
    const tools = [];

    // Check if Google Search is enabled (default: true)
    const googleSearchEnabled = await getStoredSetting('googleSearchEnabled', 'true');
    console.log('Google Search enabled:', googleSearchEnabled);

    if (googleSearchEnabled === 'true') {
        tools.push({ googleSearch: {} });
        console.log('Added Google Search tool');
    } else {
        console.log('Google Search tool disabled');
    }

    return tools;
}

async function getStoredSetting(key, defaultValue) {
    try {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            // Wait a bit for the renderer to be ready
            await new Promise(resolve => setTimeout(resolve, 100));

            // Try to get setting from renderer process localStorage
            const value = await windows[0].webContents.executeJavaScript(`
                (function() {
                    try {
                        if (typeof localStorage === 'undefined') {
                            console.log('localStorage not available yet for ${key}');
                            return '${defaultValue}';
                        }
                        const stored = localStorage.getItem('${key}');
                        console.log('Retrieved setting ${key}:', stored);
                        return stored || '${defaultValue}';
                    } catch (e) {
                        console.error('Error accessing localStorage for ${key}:', e);
                        return '${defaultValue}';
                    }
                })()
            `);
            return value;
        }
    } catch (error) {
        console.error('Error getting stored setting for', key, ':', error.message);
    }
    console.log('Using default value for', key, ':', defaultValue);
    return defaultValue;
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnect = false) {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    if (!isReconnect) {
        sendToRenderer('session-initializing', true);
    }

    // Store params for reconnection
    if (!isReconnect) {
        sessionParams = { apiKey, customPrompt, profile, language };
        reconnectAttempts = 0;
    }

    try {
        const enabledTools = await getEnabledTools();
        const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);
        const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);

        if (!isReconnect) {
            initializeNewSession(profile, customPrompt);
            // Initialize conversation context with system prompt (OpenAI format)
            conversationContext = [
                { role: 'system', content: systemPrompt }
            ];
        }

        console.log('=== OpenAI Session Initialized ===');
        console.log('[Model]:', OPENAI_MODEL);
        console.log('[Profile]:', profile);
        console.log('[Language]:', language);

        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        sendToRenderer('update-status', 'Session ready - OpenAI');
        return { type: 'openai', context: conversationContext };
    } catch (error) {
        console.error('Failed to initialize OpenAI session:', error);
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        sendToRenderer('update-status', `Error: ${error.message}`);
        return null;
    }
}

async function attemptReconnect() {
    reconnectAttempts++;
    console.log(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

    // Clear stale buffers
    currentTranscription = '';

    sendToRenderer('update-status', `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    // Wait before attempting
    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));

    try {
        const session = await initializeGeminiSession(
            sessionParams.apiKey,
            sessionParams.customPrompt,
            sessionParams.profile,
            sessionParams.language,
            true // isReconnect
        );

        if (session && global.geminiSessionRef) {
            global.geminiSessionRef.current = session;

            // Restore context from conversation history via text message
            const contextMessage = buildContextMessage();
            if (contextMessage) {
                try {
                    console.log('Restoring conversation context...');
                    await session.sendRealtimeInput({ text: contextMessage });
                } catch (contextError) {
                    console.error('Failed to restore context:', contextError);
                    // Continue without context - better than failing
                }
            }

            // Don't reset reconnectAttempts here - let it reset on next fresh session
            sendToRenderer('update-status', 'Reconnected! Listening...');
            console.log('Session reconnected successfully');
            return true;
        }
    } catch (error) {
        console.error(`Reconnection attempt ${reconnectAttempts} failed:`, error);
    }

    // If we still have attempts left, try again
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        return attemptReconnect();
    }

    // Max attempts reached - notify frontend
    console.log('Max reconnection attempts reached');
    sendToRenderer('reconnect-failed', {
        message: 'Tried 3 times to reconnect. Must be upstream/network issues. Try restarting or download updated app from site.',
    });
    sessionParams = null;
    return false;
}

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        console.log('Checking for existing SystemAudioDump processes...');

        // Kill any existing SystemAudioDump processes
        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
            stdio: 'ignore',
        });

        killProc.on('close', code => {
            if (code === 0) {
                console.log('Killed existing SystemAudioDump processes');
            } else {
                console.log('No existing SystemAudioDump processes found');
            }
            resolve();
        });

        killProc.on('error', err => {
            console.log('Error checking for existing processes (this is normal):', err.message);
            resolve();
        });

        // Timeout after 2 seconds
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;

    // Kill any existing SystemAudioDump processes first
    await killExistingSystemAudioDump();

    console.log('Starting macOS audio capture with SystemAudioDump...');

    const { app } = require('electron');

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
    } else {
        systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
    }

    console.log('SystemAudioDump path:', systemAudioPath);

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
        },
    };

    systemAudioProc = spawn(systemAudioPath, [], spawnOptions);

    if (!systemAudioProc.pid) {
        console.error('Failed to start SystemAudioDump');
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);

    const CHUNK_DURATION = 0.1;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;

            if (isPTTRecording) {
                pttAudioChunks.push(monoChunk);
                feedPTTRealtimeAudio(monoChunk);
            }

            if (process.env.DEBUG_AUDIO) {
                console.log(`Processed audio chunk: ${chunk.length} bytes`);
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        console.error('SystemAudioDump process error:', err);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

async function sendAudioToGemini(base64Data, geminiSessionRef) {
    // Note: In text-only mode, audio needs to be transcribed first
    // This function is kept for compatibility but should not be called
    // Audio should be transcribed in renderer and sent as text
    if (!geminiSessionRef.current) return;
    console.warn('sendAudioToGemini called but audio mode not supported in text-only API');
}

async function sendTextToGemini(text, model = null) {
    const modelName = model || OPENAI_MODEL;

    try {
        console.log(`=== OpenAI Text API Call ===`);
        console.log(`[Model]: ${modelName}`);
        console.log(`[Input]: ${text}`);

        const messages = [...conversationContext, { role: 'user', content: text }];

        const stream = await openai.chat.completions.create({
            model: modelName,
            messages: messages,
            stream: true
        });

        let fullText = '';
        let isFirst = true;

        for await (const chunk of stream) {
            const chunkText = chunk.choices[0]?.delta?.content || '';
            if (chunkText) {
                fullText += chunkText;
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        console.log(`=== OpenAI Response Complete ===`);
        console.log(`[Model]: ${modelName}`);
        console.log(`[Response]: ${fullText}`);

        conversationContext.push({ role: 'user', content: text });
        conversationContext.push({ role: 'assistant', content: fullText });

        if (conversationContext.length > 40) {
            // Always keep the system message at index 0
            conversationContext = [conversationContext[0], ...conversationContext.slice(-39)];
        }

        if (currentTranscription) {
            saveConversationTurn(currentTranscription, fullText);
            currentTranscription = '';
        } else {
            saveConversationTurn(text, fullText);
        }

        return { success: true, text: fullText, model: modelName };
    } catch (error) {
        console.error('=== OpenAI Text API Error ===');
        console.error('[Error]:', error.message);
        return { success: false, error: error.message };
    }
}

const DEFAULT_SCREEN_PROMPT = `Look at this screenshot carefully and identify any questions, problems, or tasks visible on screen. Then answer them directly and completely.

- **MCQ / multiple choice**: State the correct option letter and a one-line reason.
- **Coding question**: Give a brief approach (2-3 bullets), then the complete working code.
- **Math / numerical**: Show the answer and the key steps.
- **Written / essay question**: Give a concise, direct answer covering all required points.
- **General knowledge / factual**: Answer directly, no fluff.

If there are multiple questions visible, answer each one. No preamble, no meta-commentary — just the answers.`;

async function sendImageToGeminiHttp(base64Data, prompt) {
    const effectivePrompt = prompt || DEFAULT_SCREEN_PROMPT;
    try {
        console.log(`Sending image to ${OPENAI_MODEL} (streaming)...`);

        const stream = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: { url: `data:image/jpeg;base64,${base64Data}` }
                        },
                        { type: 'text', text: effectivePrompt }
                    ]
                }
            ],
            stream: true
        });

        let fullText = '';
        let isFirst = true;

        for await (const chunk of stream) {
            const chunkText = chunk.choices[0]?.delta?.content || '';
            if (chunkText) {
                fullText += chunkText;
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        console.log(`Image response completed from ${OPENAI_MODEL}`);
        saveScreenAnalysis(effectivePrompt, fullText, OPENAI_MODEL);
        return { success: true, text: fullText, model: OPENAI_MODEL };
    } catch (error) {
        console.error('Error sending image to OpenAI:', error);
        return { success: false, error: error.message };
    }
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    // Store the geminiSessionRef globally for reconnection access
    global.geminiSessionRef = geminiSessionRef;

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        // apiKey parameter kept for IPC compatibility
        const session = await initializeGeminiSession(apiKey, customPrompt, profile, language);
        if (session) {
            // Store session info
            geminiSessionRef.current = session;
            return true;
        }
        return false;
    });

    ipcMain.handle('send-audio-content', async (event, { data, mimeType }) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };

        try {
            const audioBuffer = Buffer.from(data, 'base64');
            if (isPTTRecording) {
                pttAudioChunks.push(audioBuffer);
                feedPTTRealtimeAudio(audioBuffer);
            }
            return { success: true };
        } catch (error) {
            console.error('Error processing system audio:', error);
            return { success: false, error: error.message };
        }
    });

    // Microphone path disabled — PTT uses system audio only
    ipcMain.handle('send-mic-audio-content', async () => {
        return { success: true };
    });

    ipcMain.handle('send-image-content', async (event, { data, prompt }) => {
        if (sendImageContentLocked) {
            console.warn('send-image-content: request ignored while another vision request is running');
            return { success: false, error: 'Screen analysis already in progress' };
        }
        sendImageContentLocked = true;
        try {
            if (!data || typeof data !== 'string') {
                console.error('Invalid image data received');
                return { success: false, error: 'Invalid image data' };
            }

            const buffer = Buffer.from(data, 'base64');

            if (buffer.length < 1000) {
                console.error(`Image buffer too small: ${buffer.length} bytes`);
                return { success: false, error: 'Image buffer too small' };
            }

            return await sendImageToGeminiHttp(data, prompt);
        } catch (error) {
            console.error('Error sending image:', error);
            return { success: false, error: error.message };
        } finally {
            sendImageContentLocked = false;
        }
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };

        try {
            if (!text || typeof text !== 'string' || text.trim().length === 0) {
                return { success: false, error: 'Invalid text message' };
            }

            // Use new text-based API (Option 2)
            const result = await sendTextToGemini(text.trim());
            return result;
        } catch (error) {
            console.error('Error sending text:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-macos-audio', async event => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }

        try {
            const success = await startMacOSAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio', async event => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('ptt-start', async event => {
        return runPttSequential(async () => {
            try {
                if (!geminiSessionRef.current) {
                    return { success: false, error: 'No active Gemini session' };
                }
                startPTTRealtimeSession();
                isPTTRecording = true;
                pttAudioChunks = [];
                sendToRenderer('ptt-status', { status: 'Recording…' });
                return { success: true };
            } catch (error) {
                console.error('Error on PTT start:', error);
                stopPTTRealtimeSession();
                isPTTRecording = false;
                return { success: false, error: error.message };
            }
        });
    });

    ipcMain.handle('ptt-release', async event => {
        return runPttSequential(async () => {
            let tempPath = null;
            try {
                if (!geminiSessionRef.current) {
                    isPTTRecording = false;
                    pttAudioChunks = [];
                    sendToRenderer('ptt-live-transcript-clear');
                    stopPTTRealtimeSession();
                    return { success: false, error: 'No active Gemini session' };
                }

                isPTTRecording = false;
                const chunks = [...pttAudioChunks];
                pttAudioChunks = [];

                sendToRenderer('ptt-live-transcript-clear');
                stopPTTRealtimeSession();

                sendToRenderer('ptt-status', { status: 'Transcribing…' });

                if (chunks.length === 0) {
                    sendToRenderer('ptt-complete', { success: true, skipped: true });
                    sendToRenderer('ptt-status', { status: 'idle' });
                    sendToRenderer('update-status', 'Session ready - OpenAI');
                    return { success: true };
                }

                const pcm = Buffer.concat(chunks);
                const wav = pcmToWavBuffer(pcm, 24000, 1, 16);
                tempPath = path.join(os.tmpdir(), `ptt-${Date.now()}.wav`);
                fs.writeFileSync(tempPath, wav);

                const tx = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(tempPath),
                    model: 'whisper-1',
                });

                const text = (tx.text || '').trim();
                if (text) {
                    await sendTextToGemini(text);
                }

                sendToRenderer('ptt-complete', { success: true });
                sendToRenderer('ptt-status', { status: 'idle' });
                sendToRenderer('update-status', 'Session ready - OpenAI');
                return { success: true };
            } catch (error) {
                console.error('Error on PTT release:', error);
                sendToRenderer('ptt-complete', { success: false, error: error.message });
                sendToRenderer('ptt-status', { status: 'idle' });
                sendToRenderer('update-status', 'Session ready - OpenAI');
                return { success: false, error: error.message };
            } finally {
                if (tempPath) {
                    try {
                        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                    } catch (_) {
                        /* ignore */
                    }
                }
            }
        });
    });

    ipcMain.handle('close-session', async event => {
        try {
            stopMacOSAudioCapture();
            isPTTRecording = false;
            pttAudioChunks = [];
            stopPTTRealtimeSession();

            // Set flag to prevent reconnection attempts
            isUserClosing = true;
            sessionParams = null;

            // Cleanup session
            if (geminiSessionRef.current) {
                geminiSessionRef.current = null;
                conversationContext = [];
            }

            sendToRenderer('update-status', 'Session closed');
            return { success: true };
        } catch (error) {
            console.error('Error closing session:', error);
            return { success: false, error: error.message };
        }
    });

    // Conversation history IPC handlers
    ipcMain.handle('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-google-search-setting', async (event, enabled) => {
        try {
            console.log('Google Search setting updated to:', enabled);
            // The setting is already saved in localStorage by the renderer
            // This is just for logging/confirmation
            return { success: true };
        } catch (error) {
            console.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    initializeGeminiSession,
    getEnabledTools,
    getStoredSetting,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToGemini,
    sendTextToGemini,
    sendImageToGeminiHttp,
    setupGeminiIpcHandlers,
    formatSpeakerResults,
};
