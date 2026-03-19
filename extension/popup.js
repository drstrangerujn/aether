chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const url = document.getElementById('wsUrl');

  if (response && response.connected) {
    dot.classList.add('connected');
    text.classList.add('connected');
    text.textContent = 'Connected to MCP Server';
  } else {
    text.textContent = 'Disconnected - Start server first';
  }

  if (response && response.wsUrl) {
    url.textContent = response.wsUrl;
  }
});
