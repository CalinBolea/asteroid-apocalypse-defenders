const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const errorMsg = document.getElementById('errorMsg');

function showError(msg) {
  errorMsg.textContent = msg;
  setTimeout(() => { errorMsg.textContent = ''; }, 4000);
}

function getName() {
  const name = nameInput.value.trim();
  if (!name) {
    showError('Please enter your name');
    return null;
  }
  return name;
}

createBtn.addEventListener('click', async () => {
  const name = getName();
  if (!name) return;

  createBtn.disabled = true;
  try {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const res = await fetch('api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    const data = await res.json();
    if (data.code) {
      window.location.href = 'game.html?room=' + data.code + '&name=' + encodeURIComponent(name) + '&mode=' + data.mode;
    } else {
      showError('Failed to create room');
    }
  } catch (e) {
    showError('Connection error');
  }
  createBtn.disabled = false;
});

joinBtn.addEventListener('click', async () => {
  const name = getName();
  if (!name) return;

  const code = codeInput.value.trim().toUpperCase();
  if (!code || code.length !== 4) {
    showError('Enter a 4-character room code');
    return;
  }

  joinBtn.disabled = true;
  try {
    const res = await fetch('api/rooms/' + code);
    const data = await res.json();
    if (res.ok) {
      window.location.href = 'game.html?room=' + code + '&name=' + encodeURIComponent(name) + '&mode=' + (data.mode || 'belt-chaos');
    } else {
      showError(data.error || 'Room not found');
    }
  } catch (e) {
    showError('Connection error');
  }
  joinBtn.disabled = false;
});

// Allow Enter key
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createBtn.click();
});
