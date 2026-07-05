// Note: The Web App URL will need to be replaced with the deployed Google Apps Script URL.
const GAS_WEBAPP_URL = "https://script.google.com/a/macros/techbrain.africa/s/AKfycbzN4MIg_M8P0oiB3EaVwRl2JtzTyEkPV3h7-ZI7puPpKxMkAnw3SOktX6j5nJtPk-c/exec";

document.addEventListener("DOMContentLoaded", () => {
    // Buttons & Navigation
    const refreshBtn = document.getElementById("refreshDataBtn");
    const askAgentBtn = document.getElementById("askAgentBtn");
    const newChatBtn = document.getElementById("newChatBtn");
    const sidebarToggle = document.getElementById("sidebarToggle");
    
    // Inputs & Settings
    const propertyIdInput = document.getElementById("propertyIdInput");
    const questionInput = document.getElementById("questionInput");
    const activePropertyLabel = document.getElementById("activePropertyLabel");
    const savePropertyBtn = document.getElementById("savePropertyBtn");
    
    // Layout Sections
    const sidebar = document.getElementById("sidebar");
    const welcomeScreen = document.getElementById("welcomeScreen");
    const messagesList = document.getElementById("messagesList");
    const messagesWindow = document.getElementById("messagesWindow");
    const chatLoadingIndicator = document.getElementById("chatLoadingIndicator");
    const chatHistoryList = document.getElementById("chatHistoryList");

    // Conversation State
    let activeChatId = null;
    let conversations = [];

    // Initialize Sidebar Overlay for mobile
    const overlay = document.createElement("div");
    overlay.className = "sidebar-overlay hidden";
    document.body.appendChild(overlay);

    // Mobile Sidebar Toggles
    sidebarToggle.addEventListener("click", () => {
        sidebar.classList.toggle("show");
        overlay.classList.toggle("hidden");
    });

    overlay.addEventListener("click", () => {
        sidebar.classList.remove("show");
        overlay.classList.add("hidden");
    });

    // Load conversations from local storage
    const loadConversationsFromStorage = () => {
        const stored = localStorage.getItem("ga4_advisor_chats");
        if (stored) {
            try {
                conversations = JSON.parse(stored);
            } catch (e) {
                conversations = [];
            }
        }
        renderSidebarHistory();
    };

    // Save conversations to local storage
    const saveConversationsToStorage = () => {
        localStorage.setItem("ga4_advisor_chats", JSON.stringify(conversations));
    };

    // Render Recent Chats Sidebar List
    const renderSidebarHistory = () => {
        chatHistoryList.innerHTML = "";
        
        if (conversations.length === 0) {
            const emptyItem = document.createElement("li");
            emptyItem.className = "history-item";
            emptyItem.style.pointerEvents = "none";
            emptyItem.style.opacity = "0.5";
            emptyItem.innerHTML = `<i class="ph ph-chat-centered-dots"></i>No history yet`;
            chatHistoryList.appendChild(emptyItem);
            return;
        }

        conversations.forEach(chat => {
            const li = document.createElement("li");
            li.className = `history-item ${chat.id === activeChatId ? 'active' : ''}`;
            li.innerHTML = `<i class="ph ph-chat-centered-text"></i>${chat.title}`;
            li.addEventListener("click", () => {
                loadChat(chat.id);
                // Close sidebar on mobile after clicking
                sidebar.classList.remove("show");
                overlay.classList.add("hidden");
            });
            chatHistoryList.appendChild(li);
        });
    };

    // Load selected chat session into the messages window
    const loadChat = (chatId) => {
        activeChatId = chatId;
        const chat = conversations.find(c => c.id === chatId);
        if (!chat) return;

        // Reset UI elements
        welcomeScreen.classList.add("hidden");
        messagesList.classList.remove("hidden");
        messagesList.innerHTML = "";

        // Render each saved message
        chat.messages.forEach(msg => {
            appendMessageBubble(msg.sender, msg.text);
        });

        // Set active state in sidebar
        renderSidebarHistory();
        scrollToBottom();
    };

    // Reset UI to welcome screen / new chat state
    const initNewChat = () => {
        activeChatId = null;
        welcomeScreen.classList.remove("hidden");
        messagesList.classList.add("hidden");
        messagesList.innerHTML = "";
        renderSidebarHistory();
    };

    newChatBtn.addEventListener("click", initNewChat);

    // Simple markdown parser to handle bold formatting and list items
    const parseMarkdown = (text) => {
        if (!text) return "";
        let html = text;
        
        // Escape HTML entities to prevent XSS
        html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        // Bold: **text** -> <strong>text</strong>
        html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        
        // Bullet list parsing
        const lines = html.split("\n");
        let inList = false;
        let listHtml = [];
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (line.startsWith("- ") || line.startsWith("* ")) {
                if (!inList) {
                    listHtml.push("<ul>");
                    inList = true;
                }
                listHtml.push(`<li>${line.substring(2)}</li>`);
            } else {
                if (inList) {
                    listHtml.push("</ul>");
                    inList = false;
                }
                listHtml.push(lines[i]);
            }
        }
        if (inList) {
            listHtml.push("</ul>");
        }
        
        html = listHtml.join("\n");
        html = html.replace(/\n/g, "<br>");
        html = html.replace(/<\/ul><br>/g, "</ul>").replace(/<\/li><br>/g, "</li>");
        
        return html;
    };

    // Scroll chat window to the bottom
    const scrollToBottom = () => {
        messagesWindow.scrollTop = messagesWindow.scrollHeight;
    };

    // Append a user or AI message bubble to the messages list
    const appendMessageBubble = (sender, text) => {
        const bubble = document.createElement("div");
        bubble.className = `message-bubble ${sender}`;

        const parsedContent = parseMarkdown(text);

        if (sender === "user") {
            bubble.innerHTML = `<div class="bubble-content">${parsedContent}</div>`;
        } else {
            bubble.innerHTML = `
                <div class="ai-icon-container">
                    <i class="ph ph-sparkle"></i>
                </div>
                <div class="bubble-content">${parsedContent}</div>
            `;
        }

        messagesList.appendChild(bubble);
        scrollToBottom();
    };

    // Send query to the Google Apps Script Backend
    const submitQuery = async () => {
        const question = questionInput.value.trim();
        if (!question) return;

        const propertyId = propertyIdInput.value.trim();
        activePropertyLabel.textContent = `Property ID: ${propertyId || '431424603'}`;

        // Clear input box
        questionInput.value = "";

        // Hide welcome screen and show message list
        welcomeScreen.classList.add("hidden");
        messagesList.classList.remove("hidden");

        // 1. Create or retrieve active conversation session
        if (!activeChatId) {
            activeChatId = Date.now().toString();
            const newChat = {
                id: activeChatId,
                title: question.length > 28 ? question.substring(0, 25) + "..." : question,
                messages: []
            };
            conversations.unshift(newChat); // Add to beginning of array
        }

        const activeChat = conversations.find(c => c.id === activeChatId);

        // 2. Append User message bubble to UI and state
        appendMessageBubble("user", question);
        activeChat.messages.push({ sender: "user", text: question });
        saveConversationsToStorage();
        renderSidebarHistory();

        // 3. Show Loading Indicator
        chatLoadingIndicator.classList.remove("hidden");
        scrollToBottom();

        // 4. Build API URL and parameters
        let fetchUrl = GAS_WEBAPP_URL;
        const params = ["api=true"];
        if (propertyId) params.push(`propertyId=${encodeURIComponent(propertyId)}`);
        params.push(`question=${encodeURIComponent(question)}`);
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + params.join('&');

        try {
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error('Network response was not ok');
            const result = await response.json();

            chatLoadingIndicator.classList.add("hidden");

            if (result.status === 'success' && result.ai && result.ai.answer) {
                // Append AI Response
                const aiAnswer = result.ai.answer;
                appendMessageBubble("ai", aiAnswer);
                activeChat.messages.push({ sender: "ai", text: aiAnswer });
                saveConversationsToStorage();
            } else {
                const errMsg = result.message || "Failed to process query on the server.";
                appendMessageBubble("ai", `Error: ${errMsg}`);
                activeChat.messages.push({ sender: "ai", text: `Error: ${errMsg}` });
                saveConversationsToStorage();
            }
        } catch (error) {
            console.error("Fetch error:", error);
            chatLoadingIndicator.classList.add("hidden");
            
            // Mock Fallback
            const mockAnswer = `Based on your GA4 data mock preview, the user sign-up/conversion rate is 4.2% with a 32% drop-off rate on mobile devices. For a deeper analysis, please verify your Apps Script connection and ensure your GEMINI_API_KEY is configured under Script Properties.`;
            appendMessageBubble("ai", mockAnswer);
            activeChat.messages.push({ sender: "ai", text: mockAnswer });
            saveConversationsToStorage();
        }
    };

    // Attach click events to welcome screen suggestion cards
    const attachSuggestionCardEvents = () => {
        document.querySelectorAll(".suggestion-card").forEach(card => {
            card.addEventListener("click", () => {
                const queryText = card.getAttribute("data-query");
                questionInput.value = queryText;
                submitQuery();
            });
        });
    };

    // Handlers
    askAgentBtn.addEventListener("click", submitQuery);
    
    questionInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            submitQuery();
        }
    });

    // Refresh button - triggers a general audit query on the active property
    refreshBtn.addEventListener("click", async () => {
        refreshBtn.classList.add("loading");
        const propertyId = propertyIdInput.value.trim();
        
        let fetchUrl = GAS_WEBAPP_URL;
        const params = ["api=true"];
        if (propertyId) params.push(`propertyId=${encodeURIComponent(propertyId)}`);
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + params.join('&');

        try {
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error('Network response was not ok');
            const result = await response.json();
            
            if (result.status === 'success') {
                // If it's a general refresh, let's inject a new chat summary
                initNewChat();
                activeChatId = Date.now().toString();
                
                let summaryText = `Here is a quick summary of your live GA4 Property ID: **${propertyId || '431424603'}**:\n\n`;
                if (result.data) {
                    summaryText += `* **Conversion Rate**: ${result.data.sessionConversionRate || '0.0%'}\n`;
                    summaryText += `* **Engagement Time**: ${result.data.averageEngagementTime || '0s'}\n`;
                    summaryText += `* **Mobile Drop-off**: ${result.data.dropoffRate || '0.0%'}\n`;
                    summaryText += `* **Top Channel**: ${result.data.topSourceMedium || 'N/A'}\n\n`;
                }
                
                if (result.ai && result.ai.conclusions) {
                    summaryText += `**AI Key Conclusions:**\n`;
                    result.ai.conclusions.forEach(c => {
                        summaryText += `- ${c}\n`;
                    });
                }

                const newChat = {
                    id: activeChatId,
                    title: `General Audit - ${propertyId || '431424603'}`,
                    messages: [{ sender: "ai", text: summaryText }]
                };
                
                conversations.unshift(newChat);
                saveConversationsToStorage();
                loadChat(activeChatId);
            } else {
                alert("Failed to refresh: " + result.message);
            }
        } catch (e) {
            alert("Refresh failed. Ensure the Google Apps Script Web App is deployed and reachable.");
        } finally {
            refreshBtn.classList.remove("loading");
        }
    });

    // Property ID save and load helpers
    const loadPropertyId = () => {
        const storedId = localStorage.getItem("ga4_property_id");
        if (storedId) {
            propertyIdInput.value = storedId;
            activePropertyLabel.textContent = `Property ID: ${storedId}`;
        }
    };

    const savePropertyId = () => {
        const propertyId = propertyIdInput.value.trim();
        localStorage.setItem("ga4_property_id", propertyId);
        activePropertyLabel.textContent = `Property ID: ${propertyId || '431424603'}`;
        
        // Show check icon briefly for success feedback
        const icon = savePropertyBtn.querySelector("i");
        icon.className = "ph ph-check";
        savePropertyBtn.style.color = "var(--success)";
        savePropertyBtn.style.borderColor = "var(--success)";
        
        setTimeout(() => {
            icon.className = "ph ph-floppy-disk";
            savePropertyBtn.style.color = "";
            savePropertyBtn.style.borderColor = "";
        }, 1500);
    };

    savePropertyBtn.addEventListener("click", savePropertyId);

    propertyIdInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            savePropertyId();
        }
    });

    // Initialize App
    loadConversationsFromStorage();
    loadPropertyId();
    attachSuggestionCardEvents();
});
