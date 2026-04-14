const API_BASE = '/api';

// DOM Elements
const accountList = document.getElementById('account-list');
const accountDetails = document.getElementById('account-details');
const backupControl = document.getElementById('backup-control');
const addAccountBtn = document.getElementById('add-account-btn');

const accountForm = document.getElementById('account-form');
const deleteAccountBtn = document.getElementById('delete-account-btn');
const cancelAccountBtn = document.getElementById('cancel-account-btn');
const editingAccountTitle = document.getElementById('editing-account-title');
const selectedAccountName = document.getElementById('selected-account-name');

const startBackupBtn = document.getElementById('start-backup-btn');
const stopBackupBtn = document.getElementById('stop-backup-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressStats = document.getElementById('progress-stats');
const logOutput = document.getElementById('log-output');
const clearLogsBtn = document.getElementById('clear-logs-btn');

const globalStatusDot = document.getElementById('global-status-dot');
const globalStatusText = document.getElementById('global-status-text');

let accounts = [];
let selectedAccount = null;

// Initialize
async function init() {
  await fetchAccounts();
  setupSSE();
  setupEventListeners();
}

async function fetchAccounts() {
  try {
    const res = await fetch(`${API_BASE}/accounts`);
    accounts = await res.json();
    renderAccountList();
  } catch (err) {
    console.error('Failed to fetch accounts', err);
  }
}

function renderAccountList() {
  accountList.innerHTML = '';
  accounts.forEach(acc => {
    const li = document.createElement('li');
    li.className = `account-item ${selectedAccount?.filename === acc.filename ? 'active' : ''}`;
    li.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
      <span>${acc.filename}</span>
    `;
    li.onclick = () => selectAccount(acc);
    accountList.appendChild(li);
  });
}

function selectAccount(acc) {
  selectedAccount = acc;
  renderAccountList();
  showBackupControl();
  
  // Also pre-fill form for easy editing
  document.getElementById('original-filename').value = acc.filename;
  document.getElementById('env-filename').value = acc.filename;
  document.getElementById('env-filename').disabled = true;
  document.getElementById('imap-host').value = acc.host;
  document.getElementById('imap-port').value = acc.port;
  document.getElementById('imap-user').value = acc.user;
  document.getElementById('backup-pass').value = '';
  
  const lastExecInfo = document.getElementById('last-execution-info');
  if (acc.lastExecution) {
    const formatted = new Date(acc.lastExecution).toLocaleString();
    lastExecInfo.textContent = `Last execution: ${formatted}`;
  } else {
    lastExecInfo.textContent = `No previous execution. Defaults to everything.`;
  }

  selectedAccountName.textContent = acc.filename;
}

function showAddAccount() {
  selectedAccount = null;
  renderAccountList();
  accountDetails.classList.remove('hidden');
  backupControl.classList.add('hidden');
  
  editingAccountTitle.textContent = 'Add New Account';
  accountForm.reset();
  document.getElementById('original-filename').value = '';
  document.getElementById('env-filename').disabled = false;
  deleteAccountBtn.classList.add('hidden');
}

function showBackupControl() {
  accountDetails.classList.add('hidden');
  backupControl.classList.remove('hidden');
}

function setupEventListeners() {
  addAccountBtn.onclick = showAddAccount;
  
  // Edit account link (if we want to edit instead of backup)
  selectedAccountName.onclick = () => {
    if(!selectedAccount) return;
    accountDetails.classList.remove('hidden');
    backupControl.classList.add('hidden');
    editingAccountTitle.textContent = 'Edit Account';
    deleteAccountBtn.classList.remove('hidden');
  };
  selectedAccountName.style.cursor = 'pointer';
  selectedAccountName.style.textDecoration = 'underline';

  cancelAccountBtn.onclick = () => {
    if(selectedAccount) showBackupControl();
    else accountDetails.classList.add('hidden');
  };

  accountForm.onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      filename: document.getElementById('env-filename').value,
      host: document.getElementById('imap-host').value,
      port: document.getElementById('imap-port').value,
      user: document.getElementById('imap-user').value
    };
    try {
      const res = await fetch(`${API_BASE}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if(res.ok) {
        await fetchAccounts();
        const updated = accounts.find(a => a.filename === payload.filename || a.filename === `${payload.filename}.env`);
        if(updated) selectAccount(updated);
      } else {
        const err = await res.json();
        alert('Error saving: ' + err.error);
      }
    } catch(err) {
      console.error(err);
    }
  };

  deleteAccountBtn.onclick = async () => {
    if(!selectedAccount) return;
    if(confirm(`Are you sure you want to delete ${selectedAccount.filename}?`)) {
      await fetch(`${API_BASE}/accounts/${selectedAccount.filename}`, { method: 'DELETE' });
      selectedAccount = null;
      accountDetails.classList.add('hidden');
      await fetchAccounts();
    }
  };

  startBackupBtn.onclick = async () => {
    if(!selectedAccount) return;
    const start = document.getElementById('backup-start-date').value;
    const end = document.getElementById('backup-end-date').value;
    const password = document.getElementById('backup-pass').value;
    const deleteOlderThan = document.getElementById('delete-older-than').value;
    
    if(!password) {
      alert("IMAP password is required before archiving.");
      return;
    }

    if(deleteOlderThan) {
      if(!confirm(`WARNING: You have chosen to permanently delete emails older than ${deleteOlderThan} from the remote server after backup. Are you absolutely sure you want to proceed?`)) {
        return;
      }
    }
    
    appendLog('System', `Starting backup for ${selectedAccount.filename}...`);
    try {
      const res = await fetch(`${API_BASE}/backup/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: selectedAccount.filename, start, end, password, deleteOlderThan })
      });
      if(!res.ok) {
        const err = await res.json();
        appendLog('Error', `Failed to start: ${err.error}`);
        alert(`Failed to start: ${err.error}`);
      }
    } catch(err) {
       appendLog('Error', err.message);
    }
  };

  stopBackupBtn.onclick = async () => {
    appendLog('System', 'Requesting abort...');
    await fetch(`${API_BASE}/backup/stop`, { method: 'POST' });
  };

  clearLogsBtn.onclick = () => {
    logOutput.innerHTML = '';
  };
}

function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/backup/events`);
  
  eventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    switch(data.type) {
      case 'status':
        updateStatus(data.active, data.env);
        break;
      case 'log':
        appendLog('Log', data.message);
        break;
      case 'progress':
        updateProgress(data.data);
        break;
      case 'finished':
        appendLog('System', 'Backup process finished.');
        updateStatus(false, null);
        break;
    }
  };
}

function updateStatus(isActive, envName) {
  if(isActive) {
    globalStatusDot.classList.add('active');
    globalStatusText.textContent = `Archiving ${envName}...`;
    startBackupBtn.classList.add('hidden');
    stopBackupBtn.classList.remove('hidden');
    progressContainer.classList.remove('hidden');
    
    // Disable inputs
    disableForm(true);
  } else {
    globalStatusDot.classList.remove('active');
    globalStatusText.textContent = 'Idle';
    startBackupBtn.classList.remove('hidden');
    stopBackupBtn.classList.add('hidden');
    
    disableForm(false);
  }
}

function updateProgress(data) {
  const { index, total, logMsg } = data;
  const percent = total > 0 ? (index / total) * 100 : 0;
  progressBar.style.width = `${percent}%`;
  progressStats.textContent = `${index} / ${total}`;
  appendLog('Progress', logMsg);
}

function appendLog(type, msg) {
  const div = document.createElement('div');
  div.className = `log-entry ${type.toLowerCase()}`;
  const time = new Date().toLocaleTimeString();
  
  // Format log message
  let colorMsg = msg.replace(/\u001b\[0;34m/g, '').replace(/\u001b\[0m/g, ''); // strip some terminal colors
  
  div.textContent = `[${time}] ${colorMsg}`;
  logOutput.appendChild(div);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function disableForm(disabled) {
  document.getElementById('backup-start-date').disabled = disabled;
  document.getElementById('backup-end-date').disabled = disabled;
  document.getElementById('backup-pass').disabled = disabled;
  document.getElementById('delete-older-than').disabled = disabled;
  addAccountBtn.disabled = disabled;
}

// Boot
init();
