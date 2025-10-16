// --- Timer Management ---
let timerInterval;
let seconds = 0;
// NOTE: These DOM references must be outside the DOMContentLoaded listener
// if they are used by top-level functions (like startTimer/stopTimer).
// In a clean structure, they are often placed inside the listener or defined globally.
// Since they are defined globally in the user's provided code, we ensure they link correctly.
const contentArea = document.getElementById('contentArea');
const statusMessage = document.getElementById('statusMessage');

/**
 * Starts the timer, resetting seconds and updating the status message every second.
 */
function startTimer() {
    seconds = 0;
    // Use the statusMessage area for the timer display
    if (statusMessage) {
        statusMessage.textContent = 'Thinking (0s)...';
    }
    timerInterval = setInterval(() => {
        seconds++;
        if (statusMessage) {
            statusMessage.textContent = `Thinking (${seconds}s)...`;
        }
    }, 1000);
}

/**
 * Stops the timer and clears the interval.
 */
function stopTimer() {
    clearInterval(timerInterval);
}

// --- Content Retrieval Functions (Injected into the Active Tab) ---

/**
 * This function is injected to get all visible text from the page body.
 * @returns {string} The raw text content of the page.
 */
function getPageText() {
    // Only return visible text content
    return document.body.innerText;
}

/**
 * This function is injected to get only the selected text.
 * @returns {string} The selected text.
 */
function getSelectedText() {
    return window.getSelection().toString();
}

// --- AI Summarization Core Function ---

/**
 * Uses the Chrome LanguageModel API to generate a structured, sectional summary of the input text.
 * @param {string} text - The text to summarize.
 * @returns {Promise<string>} The raw JSON string output from the model, or an error message.
 */
async function summarizeWithPrompt(text) {
    if ('LanguageModel' in window) {
        try {
            // Define the JSON schema for the required output format, now including 'sections' with subheadings.
            const summarySchema = {
                "type": "object",
                "properties": {
                    "heading": {
                        "type": "string",
                        "description": "A brief, descriptive title for the summary."
                    },
                    "sections": {
                        "type": "array",
                        "description": "A list of 2-4 sections, each with a descriptive subheading and detailed summary content.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "subheading": {
                                    "type": "string",
                                    "description": "A concise subheading for this specific section of the summary."
                                },
                                "content": {
                                    "type": "string",
                                    "description": "The detailed, neutral summary content for this section."
                                }
                            },
                            "required": ["subheading", "content"]
                        }
                    }
                },
                "required": ["heading", "sections"], // Both are now required
                "additionalProperties": false
            };

            // FIX: Specify the expected output language ('en') to satisfy new API safety warnings.
            const model = await LanguageModel.create({
                expectedOutputs: [
                    { type: "text", languages: ["en"] }
                ]
            });
            
            // Update the prompt to explicitly request the structured, sectional summary in JSON format.
            // MODIFICATION: Emphasize the JSON output format in the prompt.
            const prompt = `Provide a main title (heading) and a detailed summary of the following text, broken down into 2-4 key sections with descriptive subheadings. **The entire output must be a valid JSON object matching the requested schema. DO NOT include any explanatory text or formatting outside of the JSON object.** The text to summarize is:\n\n${text}`;
            
            // Pass the schema in the options for structured output.
            const summaryJsonString = await model.prompt(prompt, {
                responseConstraint: summarySchema
            });
            
            // Return the raw JSON string. The calling function will handle parsing and formatting.
            return summaryJsonString;
        } catch (error) {
            console.error('Error using LanguageModel API:', error);
            return `Error: ${error.message}. Please ensure the Chrome LanguageModel API is enabled/supported.`;
        }
    } else {
        return 'Error: The Chrome LanguageModel API is not supported in this browser or is not enabled.';
    }
}

// --- Action Handlers ---

/**
 * Grabs and summarizes the text from the webpage (either all or selected).
 * @param {function} extractionFunc - The content script function to execute (getPageText or getSelectedText).
 */
async function summarizePage(extractionFunc) {
    // Clear previous output and start loading state
    if (contentArea) contentArea.value = '';
    if (statusMessage) statusMessage.textContent = '';
    startTimer();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check for a valid URL
    if (!tab || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('file://')) {
        stopTimer();
        if (statusMessage) statusMessage.textContent = 'Error: Cannot access content on this type of page (e.g., settings, extension page).';
        return;
    }

    try {
        // Execute the appropriate content retrieval function
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractionFunc
        });

        const extractedText = results[0].result;

        if (extractedText && extractedText.trim().length > 0) {
            if (statusMessage) statusMessage.textContent = 'Text extracted successfully. Generating summary...';
            
            const summaryJsonString = await summarizeWithPrompt(extractedText);
            stopTimer();

            try {
                const summaryObject = JSON.parse(summaryJsonString);
                
                // Start with the main heading
                let formattedOutput = (summaryObject.heading || 'Summary Title').toUpperCase() + '\n' + '='.repeat(40) + '\n\n';
                
                // Iterate through the sections and format them
                if (summaryObject.sections && Array.isArray(summaryObject.sections)) {
                    summaryObject.sections.forEach(section => {
                        // Use a simple text divider for subheadings
                        formattedOutput += `--- ${section.subheading.toUpperCase()} ---\n`;
                        formattedOutput += `${section.content}\n\n`;
                    });
                }
                
                if (contentArea) contentArea.value = formattedOutput.trim();
                if (statusMessage) statusMessage.textContent = 'Summary complete.';
                
            } catch (parseError) {
                // Fallback: If parsing fails, display the raw text and an error
                if (contentArea) contentArea.value = `ERROR: Failed to parse structured output. Displaying raw model output:\n\n${summaryJsonString}`;
                if (statusMessage) statusMessage.textContent = `Summary complete, but structured output parsing failed.`;
                console.error('Failed to parse summary JSON:', parseError, summaryJsonString);
            }

        } else {
            stopTimer();
            if (contentArea) contentArea.value = '';
            if (statusMessage) statusMessage.textContent = extractionFunc === getPageText ? 
                'Could not retrieve any text from the page.' : 
                'No text was selected on the page.';
        }
    } catch (error) {
        stopTimer();
        console.error('Scripting Error:', error);
        if (statusMessage) statusMessage.textContent = `Scripting Error: Could not execute script on the page.`;
    }
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Get DOM References (re-declared for local scope protection)
    // We re-reference them here for local use, even though the globals above rely on them.
    const showAllBtn = document.getElementById('showAllBtn');
    const showSelectedBtn = document.getElementById('showSelectedBtn');

    // Button to summarize the entire page content
    if (showAllBtn) {
        showAllBtn.addEventListener('click', () => summarizePage(getPageText));
    }

    // Button to summarize the selected text content
    if (showSelectedBtn) {
        showSelectedBtn.addEventListener('click', () => summarizePage(getSelectedText));
    }

    // Initial message on load
    if (statusMessage) {
        statusMessage.textContent = 'Click a button to summarize content.';
    }
});

