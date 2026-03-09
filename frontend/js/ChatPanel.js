/**
 * ChatPanel - Chat UI component for the assistant panel.
 * Builds header, messages area, typing indicator, and input area.
 */
export class ChatPanel {

    constructor(containerElement) {
        this.container = containerElement;
        this._onSendCallback = null;
        this._onSttToggleCallback = null;
        this._onTtsToggleCallback = null;
        this._sttActive = false;
        this._build();
    }

    _build() {
        const panel = document.createElement('div');
        panel.className = 'chat-panel';

        // Header (reuses toc-header style)
        const header = document.createElement('div');
        header.className = 'toc-header';
        const title = document.createElement('div');
        title.className = 'toc-title';
        title.textContent = 'Assistant';
        header.appendChild(title);
        panel.appendChild(header);

        // Messages area
        this._messagesArea = document.createElement('div');
        this._messagesArea.className = 'chat-messages';
        panel.appendChild(this._messagesArea);

        // Typing indicator
        this._typingIndicator = document.createElement('div');
        this._typingIndicator.className = 'chat-typing-indicator';
        this._typingIndicator.innerHTML = '<span></span><span></span><span></span>';
        this._typingIndicator.style.display = 'none';
        this._messagesArea.appendChild(this._typingIndicator);

        // Input area
        const inputArea = document.createElement('div');
        inputArea.className = 'chat-input-area';

        // STT button
        this._sttBtn = document.createElement('button');
        this._sttBtn.className = 'chat-stt-btn';
        this._sttBtn.title = 'Voice input';
        this._sttBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="1" width="6" height="12" rx="3" fill="#f4b4b4"/><path d="M12 1a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
        this._sttBtn.addEventListener('click', () => {
            this._sttActive = !this._sttActive;
            this._sttBtn.classList.toggle('active', this._sttActive);
            if (this._onSttToggleCallback) this._onSttToggleCallback(this._sttActive);
        });
        inputArea.appendChild(this._sttBtn);

        // Text input
        this._input = document.createElement('textarea');
        this._input.className = 'chat-input';
        this._input.placeholder = 'Type a message...';
        this._input.rows = 1;
        this._input.spellcheck = false;
        this._input.addEventListener('input', () => this._autoGrow());
        this._input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._handleSend();
            }
        });
        inputArea.appendChild(this._input);

        // Send button
        const sendBtn = document.createElement('button');
        sendBtn.className = 'chat-send-btn';
        sendBtn.title = 'Send message';
        sendBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 2 15 22 11 13 2 9" fill="#b4e4b4"/><line x1="22" y1="2" x2="11" y2="13"/></svg>';
        sendBtn.addEventListener('click', () => this._handleSend());
        inputArea.appendChild(sendBtn);

        // TTS button
        this._ttsBtn = document.createElement('button');
        this._ttsBtn.className = 'chat-tts-btn';
        this._ttsBtn.title = 'Text to speech';
        this._ttsIconOff = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19" fill="#b4d4f4"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';
        this._ttsIconOn = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19" fill="#b4d4f4"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
        this._ttsBtn.innerHTML = this._ttsIconOff;
        this._ttsActive = false;
        this._ttsBtn.addEventListener('click', () => {
            this._ttsActive = !this._ttsActive;
            this._ttsBtn.classList.toggle('active', this._ttsActive);
            this._ttsBtn.innerHTML = this._ttsActive ? this._ttsIconOn : this._ttsIconOff;
            if (this._onTtsToggleCallback) this._onTtsToggleCallback();
        });
        inputArea.appendChild(this._ttsBtn);

        panel.appendChild(inputArea);
        this.container.appendChild(panel);
    }

    _autoGrow() {
        this._input.style.height = 'auto';
        this._input.style.height = Math.min(this._input.scrollHeight, 120) + 'px';
    }

    _handleSend() {
        const text = this._input.value.trim();
        if (!text) return;

        this.addMessage('user', text);
        this._input.value = '';
        this._input.style.height = 'auto';

        if (this._onSendCallback) {
            this._onSendCallback(text);
        }
    }

    addMessage(role, text) {
        const msg = document.createElement('div');
        msg.className = `chat-message chat-message-${role}`;

        if (role === 'assistant') {
            msg.innerHTML = marked.parse(text);
            msg.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        } else {
            msg.textContent = text;
        }

        // Insert before typing indicator
        this._messagesArea.insertBefore(msg, this._typingIndicator);
        this._messagesArea.scrollTop = this._messagesArea.scrollHeight;
    }

    clearMessages() {
        const messages = this._messagesArea.querySelectorAll('.chat-message');
        messages.forEach(m => m.remove());
    }

    setLoading(loading) {
        this._typingIndicator.style.display = loading ? 'flex' : 'none';
        if (loading) {
            this._messagesArea.scrollTop = this._messagesArea.scrollHeight;
        }
    }

    onSend(callback) {
        this._onSendCallback = callback;
    }

    onSttToggle(callback) {
        this._onSttToggleCallback = callback;
    }

    onTtsToggle(callback) {
        this._onTtsToggleCallback = callback;
    }

    setTtsActive(active) {
        this._ttsActive = active;
        this._ttsBtn.classList.toggle('active', active);
        this._ttsBtn.innerHTML = active ? this._ttsIconOn : this._ttsIconOff;
    }
}
