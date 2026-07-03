(function () {
    const API_URL = (() => {
        if (window.location.protocol === 'file:') return 'http://localhost:5000/api';
        const host = window.location.hostname;
        const port = window.location.port;
        if ((host === 'localhost' || host === '127.0.0.1') && port && port !== '5000') {
            return `http://${host}:5000/api`;
        }
        return `${window.location.origin}/api`;
    })();
    const token = localStorage.getItem('mfp_token');

    const chatFab = document.getElementById('chatFab');
    const panel = document.getElementById('userChatPanel');
    const closeBtn = document.getElementById('closeChatPanel');
    const messagesEl = document.getElementById('userChatMessages');
    const form = document.getElementById('userChatForm');
    const input = document.getElementById('userChatInput');
    const statusText = document.getElementById('adminStatusText');
    const revertBtn = document.getElementById('revertLoginBtn');
    const openUserAiBtn = document.getElementById('openUserAiBtn');
    const userAiPanel = document.getElementById('userAiPanel');
    const closeUserAiBtn = document.getElementById('closeUserAiBtn');
    const userAiForm = document.getElementById('userAiForm');
    const userAiInput = document.getElementById('userAiInput');
    const userAiAnswer = document.getElementById('userAiAnswer');

    if (!chatFab || !panel || !closeBtn || !messagesEl || !form || !input || !statusText || !token) return;

    let pollTimer = null;
    let statusTimer = null;

    function formatTime(value) {
        const date = value ? new Date(value) : new Date();
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function renderMessages(messages) {
        messagesEl.innerHTML = '';
        if (!messages || messages.length === 0) {
            messagesEl.innerHTML = '<div class="user-chat-empty">No messages yet. Start chat with admin.</div>';
            return;
        }

        messages.forEach((msg) => {
            const box = document.createElement('div');
            box.className = `chat-msg ${msg.sender_type === 'user' ? 'user' : 'admin'}`;
            box.innerHTML = `${msg.message}<div class="chat-msg-time">${formatTime(msg.created_at)}</div>`;
            messagesEl.appendChild(box);
        });

        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function fetchMessages() {
        try {
            const res = await fetch(`${API_URL}/chat/messages`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return;
            const data = await res.json();
            renderMessages(data.messages || []);
        } catch {
            // keep silent to avoid noisy UI
        }
    }

    async function refreshAdminStatus() {
        try {
            const res = await fetch(`${API_URL}/chat/status`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return;
            const data = await res.json();
            statusText.textContent = data.adminOnline
                ? 'Admin is online now'
                : 'Admin offline • You will receive a waiting message';
        } catch {
            statusText.textContent = 'Status unavailable right now';
        }
    }

    async function refreshAiAccess() {
        if (!openUserAiBtn) return;
        try {
            const res = await fetch(`${API_URL}/ai/my-access`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                openUserAiBtn.style.display = 'none';
                return;
            }
            const data = await res.json();
            openUserAiBtn.style.display = data.allowed ? 'inline-flex' : 'none';
            if (!data.allowed && userAiPanel) userAiPanel.style.display = 'none';
        } catch {
            openUserAiBtn.style.display = 'none';
        }
    }

    function openChatPanel() {
        panel.style.display = 'flex';
        fetchMessages();
        refreshAdminStatus();
        refreshAiAccess();

        if (pollTimer) clearInterval(pollTimer);
        if (statusTimer) clearInterval(statusTimer);

        pollTimer = setInterval(fetchMessages, 4000);
        statusTimer = setInterval(refreshAdminStatus, 12000);
    }

    function closeChatPanel() {
        panel.style.display = 'none';
        if (pollTimer) clearInterval(pollTimer);
        if (statusTimer) clearInterval(statusTimer);
    }

    chatFab.addEventListener('click', () => {
        if (panel.style.display === 'none' || !panel.style.display) {
            openChatPanel();
        } else {
            closeChatPanel();
        }
    });

    closeBtn.addEventListener('click', closeChatPanel);

    if (openUserAiBtn && userAiPanel) {
        openUserAiBtn.addEventListener('click', () => {
            userAiPanel.style.display = 'block';
        });
    }

    if (closeUserAiBtn && userAiPanel) {
        closeUserAiBtn.addEventListener('click', () => {
            userAiPanel.style.display = 'none';
        });
    }

    if (userAiForm && userAiInput && userAiAnswer) {
        userAiForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const query = userAiInput.value.trim();
            if (!query) return;

            userAiAnswer.textContent = 'Thinking...';
            try {
                const res = await fetch(`${API_URL}/ai/query`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({ query })
                });
                const data = await res.json();
                if (!res.ok) {
                    userAiAnswer.textContent = data.error || 'AI request failed';
                    return;
                }
                userAiAnswer.textContent = data.answer || 'No response';
                userAiInput.value = '';
            } catch {
                userAiAnswer.textContent = 'AI request failed';
            }
        });
    }

    // Revert login page on demand (calls server restore endpoint)
    if (revertBtn) {
        revertBtn.addEventListener('click', async () => {
            if (!confirm('Revert the login page to saved original state?')) return;
            try {
                const res = await fetch(`${API_URL}/revert-login`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!res.ok) {
                    alert('Revert failed');
                    return;
                }
                alert('Login page reverted to previous state.');
            } catch (e) {
                alert('Revert request failed');
            }
        });
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const message = input.value.trim();
        if (!message) return;

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;

        try {
            const res = await fetch(`${API_URL}/chat/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ message })
            });

            if (res.ok) {
                input.value = '';
                await fetchMessages();
                refreshAdminStatus();
            }
        } catch {
            // silent fail
        } finally {
            submitBtn.disabled = false;
        }
    });
})();
