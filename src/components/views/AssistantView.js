import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class AssistantView extends LitElement {
    static styles = css`
        :host {
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        * {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            cursor: default;
        }

        .response-container {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            font-size: var(--response-font-size, 16px);
            line-height: 1.6;
            background: var(--bg-primary);
            padding: 12px;
            scroll-behavior: smooth;
            user-select: text;
            cursor: text;
        }

        .response-container * {
            user-select: text;
            cursor: text;
        }

        .response-container a {
            cursor: pointer;
        }

        /* Word display (no animation) */
        .response-container [data-word] {
            display: inline-block;
        }

        /* Markdown styling */
        .response-container h1,
        .response-container h2,
        .response-container h3,
        .response-container h4,
        .response-container h5,
        .response-container h6 {
            margin: 1em 0 0.5em 0;
            color: var(--text-color);
            font-weight: 600;
        }

        .response-container h1 { font-size: 1.6em; }
        .response-container h2 { font-size: 1.4em; }
        .response-container h3 { font-size: 1.2em; }
        .response-container h4 { font-size: 1.1em; }
        .response-container h5 { font-size: 1em; }
        .response-container h6 { font-size: 0.9em; }

        .response-container p {
            margin: 0.6em 0;
            color: var(--text-color);
        }

        .response-container ul,
        .response-container ol {
            margin: 0.6em 0;
            padding-left: 1.5em;
            color: var(--text-color);
        }

        .response-container li {
            margin: 0.3em 0;
        }

        .response-container blockquote {
            margin: 0.8em 0;
            padding: 0.5em 1em;
            border-left: 2px solid var(--border-default);
            background: var(--bg-secondary);
        }

        .response-container code {
            background: var(--bg-tertiary);
            padding: 0.15em 0.4em;
            border-radius: 3px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 0.85em;
        }

        .response-container pre {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 3px;
            padding: 12px;
            overflow-x: auto;
            margin: 0.8em 0;
        }

        .response-container pre code {
            background: none;
            padding: 0;
        }

        .response-container a {
            color: var(--text-color);
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        .response-container strong,
        .response-container b {
            font-weight: 600;
        }

        .response-container hr {
            border: none;
            border-top: 1px solid var(--border-color);
            margin: 1.5em 0;
        }

        .response-container table {
            border-collapse: collapse;
            width: 100%;
            margin: 0.8em 0;
        }

        .response-container th,
        .response-container td {
            border: 1px solid var(--border-color);
            padding: 8px;
            text-align: left;
        }

        .response-container th {
            background: var(--bg-secondary);
            font-weight: 600;
        }

        .response-container::-webkit-scrollbar {
            width: 8px;
        }

        .response-container::-webkit-scrollbar-track {
            background: transparent;
        }

        .response-container::-webkit-scrollbar-thumb {
            background: var(--scrollbar-thumb);
            border-radius: 4px;
        }

        .response-container::-webkit-scrollbar-thumb:hover {
            background: var(--scrollbar-thumb-hover);
        }

        .ptt-live-strip {
            flex-shrink: 0;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color);
            background: var(--bg-secondary);
            font-size: 12px;
            color: var(--text-secondary);
            line-height: 1.45;
            max-height: 72px;
            overflow-y: auto;
        }

        .ptt-live-strip .ptt-live-heading {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            opacity: 0.65;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .ptt-live-strip .live-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: rgb(239, 68, 68);
            animation: pttPulse 1.2s ease-in-out infinite;
        }

        @keyframes pttPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.35; }
        }

        .ptt-live-strip .ptt-live-body {
            color: var(--text-color);
            font-size: 13px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .text-input-container {
            display: flex;
            gap: 8px;
            margin-top: 8px;
            align-items: center;
        }

        .text-input-container input {
            flex: 1;
            background: transparent;
            color: var(--text-color);
            border: none;
            border-bottom: 1px solid var(--border-color);
            padding: 8px 4px;
            border-radius: 0;
            font-size: 13px;
        }

        .text-input-container input:focus {
            outline: none;
            border-bottom-color: var(--text-color);
        }

        .text-input-container input::placeholder {
            color: var(--placeholder-color);
        }

        .nav-button {
            background: transparent;
            color: var(--text-secondary);
            border: none;
            padding: 6px;
            border-radius: 3px;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.1s ease;
        }

        .nav-button:hover {
            background: var(--hover-background);
            color: var(--text-color);
        }

        .nav-button:disabled {
            opacity: 0.3;
        }

        .nav-button svg {
            width: 18px;
            height: 18px;
            stroke: currentColor;
        }

        .response-counter {
            font-size: 11px;
            color: var(--text-muted);
            white-space: nowrap;
            min-width: 50px;
            text-align: center;
            font-family: 'SF Mono', Monaco, monospace;
        }

        .screen-answer-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            background: var(--btn-primary-bg, #ffffff);
            color: var(--btn-primary-text, #000000);
            border: none;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
        }

        .screen-answer-btn:hover {
            background: var(--btn-primary-hover, #f0f0f0);
        }

        .screen-answer-btn svg {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }

        .screen-answer-btn .usage-count {
            font-size: 11px;
            opacity: 0.7;
            font-family: 'SF Mono', Monaco, monospace;
        }

        .screen-answer-btn-wrapper {
            position: relative;
        }

        .screen-answer-btn-wrapper .tooltip {
            position: absolute;
            bottom: 100%;
            right: 0;
            margin-bottom: 8px;
            background: var(--tooltip-bg, #1a1a1a);
            color: var(--tooltip-text, #ffffff);
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 11px;
            white-space: nowrap;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.15s ease, visibility 0.15s ease;
            pointer-events: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 100;
        }

        .screen-answer-btn-wrapper .tooltip::after {
            content: '';
            position: absolute;
            top: 100%;
            right: 16px;
            border: 6px solid transparent;
            border-top-color: var(--tooltip-bg, #1a1a1a);
        }

        .screen-answer-btn-wrapper:hover .tooltip {
            opacity: 1;
            visibility: visible;
        }

        .tooltip-row {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 4px;
        }

        .tooltip-row:last-child {
            margin-bottom: 0;
        }

        .tooltip-label {
            opacity: 0.7;
        }

        .tooltip-value {
            font-family: 'SF Mono', Monaco, monospace;
        }

        .tooltip-note {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid rgba(255,255,255,0.1);
            opacity: 0.5;
            font-size: 10px;
        }

        .ptt-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            background: transparent;
            color: var(--text-secondary);
            border: 1px solid var(--border-color);
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.1s ease, border-color 0.1s ease, color 0.1s ease, box-shadow 0.1s ease;
            white-space: nowrap;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
        }

        .ptt-btn:hover {
            border-color: var(--text-secondary);
            color: var(--text-color);
        }

        .ptt-btn.recording {
            background: rgba(239, 68, 68, 0.15);
            border-color: rgb(239, 68, 68);
            color: rgb(239, 68, 68);
            box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
        }

        .ptt-btn.processing {
            opacity: 0.65;
            cursor: wait;
            pointer-events: none;
        }

        .ptt-btn svg {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
        }
    `;

    static properties = {
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedProfile: { type: String },
        onSendText: { type: Function },
        shouldAnimateResponse: { type: Boolean },
        flashCount: { type: Number },
        flashLiteCount: { type: Number },
        pttPhase: { type: String },
        pttLiveText: { type: String },
    };

    constructor() {
        super();
        this.responses = [];
        this.currentResponseIndex = -1;
        this.selectedProfile = 'interview';
        this.onSendText = () => {};
        this.flashCount = 0;
        this.flashLiteCount = 0;
        this.pttPhase = 'idle';
        this.pttLiveText = '';
        /** @type {Promise<any>|null} */
        this._pttStartPromise = null;
    }

    getProfileNames() {
        return {
            interview: 'Job Interview',
            sales: 'Sales Call',
            meeting: 'Business Meeting',
            presentation: 'Presentation',
            negotiation: 'Negotiation',
            exam: 'Exam Assistant',
        };
    }

    getCurrentResponse() {
        const profileNames = this.getProfileNames();
        return this.responses.length > 0 && this.currentResponseIndex >= 0
            ? this.responses[this.currentResponseIndex]
            : `Hey, Im listening to your ${profileNames[this.selectedProfile] || 'session'}?`;
    }

    renderMarkdown(content) {
        // Check if marked is available
        if (typeof window !== 'undefined' && window.marked) {
            try {
                // Configure marked for better security and formatting
                window.marked.setOptions({
                    breaks: true,
                    gfm: true,
                    sanitize: false, // We trust the AI responses
                });
                let rendered = window.marked.parse(content);
                rendered = this.wrapWordsInSpans(rendered);
                return rendered;
            } catch (error) {
                console.warn('Error parsing markdown:', error);
                return content; // Fallback to plain text
            }
        }
        console.log('Marked not available, using plain text');
        return content; // Fallback if marked is not available
    }

    wrapWordsInSpans(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const tagsToSkip = ['PRE'];

        function wrap(node) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() && !tagsToSkip.includes(node.parentNode.tagName)) {
                const words = node.textContent.split(/(\s+)/);
                const frag = document.createDocumentFragment();
                words.forEach(word => {
                    if (word.trim()) {
                        const span = document.createElement('span');
                        span.setAttribute('data-word', '');
                        span.textContent = word;
                        frag.appendChild(span);
                    } else {
                        frag.appendChild(document.createTextNode(word));
                    }
                });
                node.parentNode.replaceChild(frag, node);
            } else if (node.nodeType === Node.ELEMENT_NODE && !tagsToSkip.includes(node.tagName)) {
                Array.from(node.childNodes).forEach(wrap);
            }
        }
        Array.from(doc.body.childNodes).forEach(wrap);
        return doc.body.innerHTML;
    }

    getResponseCounter() {
        return this.responses.length > 0 ? `${this.currentResponseIndex + 1}/${this.responses.length}` : '';
    }

    navigateToPreviousResponse() {
        if (this.currentResponseIndex > 0) {
            this.currentResponseIndex--;
            this.dispatchEvent(
                new CustomEvent('response-index-changed', {
                    detail: { index: this.currentResponseIndex },
                })
            );
            this.requestUpdate();
        }
    }

    navigateToNextResponse() {
        if (this.currentResponseIndex < this.responses.length - 1) {
            this.currentResponseIndex++;
            this.dispatchEvent(
                new CustomEvent('response-index-changed', {
                    detail: { index: this.currentResponseIndex },
                })
            );
            this.requestUpdate();
        }
    }

    scrollResponseUp() {
        const container = this.shadowRoot.querySelector('.response-container');
        if (container) {
            const scrollAmount = container.clientHeight * 0.3; // Scroll 30% of container height
            container.scrollTop = Math.max(0, container.scrollTop - scrollAmount);
        }
    }

    scrollResponseDown() {
        const container = this.shadowRoot.querySelector('.response-container');
        if (container) {
            const scrollAmount = container.clientHeight * 0.3; // Scroll 30% of container height
            container.scrollTop = Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + scrollAmount);
        }
    }

    connectedCallback() {
        super.connectedCallback();

        // Load limits on mount
        this.loadLimits();

        // Set up IPC listeners for keyboard shortcuts
        if (window.require) {
            const { ipcRenderer } = window.require('electron');

            this.handlePreviousResponse = () => {
                console.log('Received navigate-previous-response message');
                this.navigateToPreviousResponse();
            };

            this.handleNextResponse = () => {
                console.log('Received navigate-next-response message');
                this.navigateToNextResponse();
            };

            this.handleScrollUp = () => {
                console.log('Received scroll-response-up message');
                this.scrollResponseUp();
            };

            this.handleScrollDown = () => {
                console.log('Received scroll-response-down message');
                this.scrollResponseDown();
            };

            ipcRenderer.on('navigate-previous-response', this.handlePreviousResponse);
            ipcRenderer.on('navigate-next-response', this.handleNextResponse);
            ipcRenderer.on('scroll-response-up', this.handleScrollUp);
            ipcRenderer.on('scroll-response-down', this.handleScrollDown);

            this.handlePttLiveTranscript = (_evt, data) => {
                this.pttLiveText = typeof data?.text === 'string' ? data.text : '';
            };
            this.handlePttLiveClear = () => {
                this.pttLiveText = '';
            };
            ipcRenderer.on('ptt-live-transcript', this.handlePttLiveTranscript);
            ipcRenderer.on('ptt-live-transcript-clear', this.handlePttLiveClear);
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();

        // Clean up IPC listeners
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            if (this.handlePreviousResponse) {
                ipcRenderer.removeListener('navigate-previous-response', this.handlePreviousResponse);
            }
            if (this.handleNextResponse) {
                ipcRenderer.removeListener('navigate-next-response', this.handleNextResponse);
            }
            if (this.handleScrollUp) {
                ipcRenderer.removeListener('scroll-response-up', this.handleScrollUp);
            }
            if (this.handleScrollDown) {
                ipcRenderer.removeListener('scroll-response-down', this.handleScrollDown);
            }
            if (this.handlePttLiveTranscript) {
                ipcRenderer.removeListener('ptt-live-transcript', this.handlePttLiveTranscript);
            }
            if (this.handlePttLiveClear) {
                ipcRenderer.removeListener('ptt-live-transcript-clear', this.handlePttLiveClear);
            }
        }
    }

    async handleSendText() {
        const textInput = this.shadowRoot.querySelector('#textInput');
        if (textInput && textInput.value.trim()) {
            const message = textInput.value.trim();
            textInput.value = ''; // Clear input
            await this.onSendText(message);
        }
    }

    handleTextKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSendText();
        }
    }

    async handlePTTStart(e) {
        if (this.pttPhase !== 'idle') return;
        e.currentTarget.setPointerCapture(e.pointerId);
        this.pttPhase = 'recording';
        this.pttLiveText = '';
        this._pttStartPromise = window.cheatingDaddy.startPTT();
        const result = await this._pttStartPromise;
        this._pttStartPromise = null;
        if (!result?.success) {
            try {
                e.currentTarget.releasePointerCapture(e.pointerId);
            } catch (_) {
                /* ignore */
            }
            this.pttPhase = 'idle';
        }
    }

    async handlePTTStop(e) {
        if (this.pttPhase !== 'recording') return;
        try {
            if (e.pointerId != null) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch (_) {
            /* ignore */
        }
        this.pttPhase = 'processing';
        try {
            if (this._pttStartPromise) {
                await this._pttStartPromise;
            }
            await window.cheatingDaddy.stopPTT();
        } finally {
            this._pttStartPromise = null;
            this.pttPhase = 'idle';
        }
    }

    async loadLimits() {
        if (window.cheatingDaddy?.storage?.getTodayLimits) {
            const limits = await window.cheatingDaddy.storage.getTodayLimits();
            this.flashCount = limits.flash?.count || 0;
            this.flashLiteCount = limits.flashLite?.count || 0;
        }
    }

    getTotalUsed() {
        return this.flashCount + this.flashLiteCount;
    }

    getTotalAvailable() {
        return 40; // 20 flash + 20 flash-lite
    }

    async handleScreenAnswer() {
        if (window.captureManualScreenshot) {
            window.captureManualScreenshot();
            // Reload limits after a short delay to catch the update
            setTimeout(() => this.loadLimits(), 1000);
        }
    }

    scrollToBottom() {
        setTimeout(() => {
            const container = this.shadowRoot.querySelector('.response-container');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }, 0);
    }

    firstUpdated() {
        super.firstUpdated();
        this.updateResponseContent();
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        if (changedProperties.has('responses') || changedProperties.has('currentResponseIndex')) {
            this.updateResponseContent();
        }
    }

    updateResponseContent() {
        console.log('updateResponseContent called');
        const container = this.shadowRoot.querySelector('#responseContainer');
        if (container) {
            const currentResponse = this.getCurrentResponse();
            console.log('Current response:', currentResponse);
            const renderedResponse = this.renderMarkdown(currentResponse);
            console.log('Rendered response:', renderedResponse);
            container.innerHTML = renderedResponse;
            // Show all words immediately (no animation)
            if (this.shouldAnimateResponse) {
                this.dispatchEvent(new CustomEvent('response-animation-complete', { bubbles: true, composed: true }));
            }
        } else {
            console.log('Response container not found');
        }
    }

    render() {
        const responseCounter = this.getResponseCounter();
        const showLiveStrip =
            this.pttPhase !== 'idle' || (this.pttLiveText && this.pttLiveText.trim().length > 0);
        const liveBody =
            this.pttLiveText.trim().length > 0
                ? this.pttLiveText
                : this.pttPhase === 'recording'
                  ? 'Listening…'
                  : this.pttPhase === 'processing'
                    ? 'Finishing transcription…'
                    : '';

        return html`
            <div class="ptt-live-strip" ?hidden=${!showLiveStrip}>
                ${this.pttPhase === 'recording'
                    ? html`<div class="ptt-live-heading"><span class="live-dot"></span>Live transcript</div>`
                    : ''}
                <div class="ptt-live-body">${liveBody}</div>
            </div>

            <div class="response-container" id="responseContainer"></div>

            <div class="text-input-container">
                <button class="nav-button" @click=${this.navigateToPreviousResponse} ?disabled=${this.currentResponseIndex <= 0}>
                    <svg width="24px" height="24px" stroke-width="1.7" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M15 6L9 12L15 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
                    </svg>
                </button>

                ${this.responses.length > 0 ? html`<span class="response-counter">${responseCounter}</span>` : ''}

                <button class="nav-button" @click=${this.navigateToNextResponse} ?disabled=${this.currentResponseIndex >= this.responses.length - 1}>
                    <svg width="24px" height="24px" stroke-width="1.7" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
                    </svg>
                </button>

                <input type="text" id="textInput" placeholder="Type a message to the AI..." @keydown=${this.handleTextKeydown} />

                <button
                    class="ptt-btn ${this.pttPhase === 'recording' ? 'recording' : ''} ${this.pttPhase === 'processing' ? 'processing' : ''}"
                    ?disabled=${this.pttPhase === 'processing'}
                    @pointerdown=${this.handlePTTStart}
                    @pointerup=${this.handlePTTStop}
                    @pointercancel=${this.handlePTTStop}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                        <line x1="12" y1="19" x2="12" y2="22"/>
                    </svg>
                    ${this.pttPhase === 'recording'
                        ? 'Recording…'
                        : this.pttPhase === 'processing'
                          ? 'Sending…'
                          : 'Hold to talk'}
                </button>

                <div class="screen-answer-btn-wrapper">
                    <div class="tooltip">
                        <div class="tooltip-row">
                            <span class="tooltip-label">Flash</span>
                            <span class="tooltip-value">${this.flashCount}/20</span>
                        </div>
                        <div class="tooltip-row">
                            <span class="tooltip-label">Flash Lite</span>
                            <span class="tooltip-value">${this.flashLiteCount}/20</span>
                        </div>
                        <div class="tooltip-note">Resets every 24 hours</div>
                    </div>
                    <button class="screen-answer-btn" @click=${this.handleScreenAnswer}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
                        </svg>
                        <span>Analyze screen</span>
                        <span class="usage-count">(${this.getTotalUsed()}/${this.getTotalAvailable()})</span>
                    </button>
                </div>
            </div>
        `;
    }
}

customElements.define('assistant-view', AssistantView);
