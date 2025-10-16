// Set the side panel to be available on all tabs by default
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Error setting side panel behavior:', error));


// Listener for messages coming from sidepanel.html
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    
    // Find the currently active and focused tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
        console.error("No active tab found.");
        // Send an error message back to the side panel
        chrome.runtime.sendMessage({ 
            action: 'contentResponse', 
            content: 'Error: Could not access the active tab. Make sure a web page is open.' 
        });
        return;
    }

    let funcToExecute;
    let extractionType;

    if (message.action === 'getAllContent') {
        // Function to extract all visible text content from the body
        funcToExecute = () => document.body.innerText;
        extractionType = 'All Content';
    } else if (message.action === 'getSelectedContent') {
        // Function to extract text currently highlighted by the user
        funcToExecute = () => window.getSelection().toString();
        extractionType = 'Selected Content';
    } else {
        return; // Ignore unknown messages
    }

    try {
        // Execute the relevant function (funcToExecute) in the active tab's context
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: funcToExecute
        });
        
        // The result is an array, we care about the first element's result
        const content = injectionResults[0].result || '';
        
        // Send the extracted content back to the side panel
        chrome.runtime.sendMessage({ action: 'contentResponse', content: content });

    } catch (error) {
        console.error(`Script injection failed for ${extractionType}:`, error);
        // Send an error message back
        chrome.runtime.sendMessage({ 
            action: 'contentResponse', 
            content: `Error retrieving content: ${error.message}. This might be due to security restrictions (e.g., on a Chrome settings page).` 
        });
    }
});