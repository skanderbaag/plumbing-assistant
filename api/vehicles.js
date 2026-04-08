const MAINTENANCE_INTERVALS = {
  'Oil change': 5000,
  'Tire rotation': 6000,
  'Air filter': 15000,
  'Brake inspection': 20000,
  'Transmission service': 30000
};

let currentVehicle = null;
let allVehicles = [];

async function loadVehicles() {
  const grid = document.getElementById('vehicles-grid');
  grid.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:13px;padding:20px;">Loading fleet...</div>';
  try {
    const res = await fetch('/api/vehicles?action=vehicles');
    allVehicles = await res.json();
    grid.innerHTML = '';
    for (const v of allVehicles) {
      const history = await fetch(`/api/vehicles?action=history&vehicle_id=${v.id}`).then(r => r.json());
      const issues = await fetch(`/api/vehicles?action=issues&vehicle_id=${v.id}`).then(r => r.json());
      const status = getFleetStatus(v, history);
      const card = document.createElement('div');
      card.className = `vehicle-card status-${status.level}`;
      card.innerHTML = `
        <div class="vehicle-header">
          <div>
            <div class="vehicle-name">${v.name}</div>
            <div class="vehicle-info">${v.year} ${v.make} ${v.model}</div>
          </div>
          <span class="status-pill ${status.level}">${status.label}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
          <div class="vehicle-mileage">${v.current_mileage.toLocaleString()} miles</div>
          ${issues.length > 0 ? `<span style="font-size:12px;color:#dc2626;font-weight:600;">${issues.length} open issue${issues.length > 1 ? 's' : ''}</span>` : ''}
        </div>
        ${v.assigned_driver ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;">Driver: ${v.assigned_driver}</div>` : ''}
      `;
      card.onclick = () => openVehicleDetail(v);
      grid.appendChild(card);
    }
  } catch(e) {
    grid.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:13px;padding:20px;">Error loading fleet. Try refreshing.</div>';
  }
}

function getFleetStatus(vehicle, history) {
  let worstLevel = 'good';
  for (const [service, interval] of Object.entries(MAINTENANCE_INTERVALS)) {
    const last = history.find(h => h.service_type === service);
    const lastMileage = last ? last.mileage_at_service : 0;
    const milesSince = vehicle.current_mileage - lastMileage;
    const pct = milesSince / interval;
    if (pct >= 1) { worstLevel = 'overdue'; break; }
    if (pct >= 0.85 && worstLevel === 'good') worstLevel = 'warning';
  }
  const labels = { good: 'Current', warning: 'Due soon', overdue: 'Overdue' };
  return { level: worstLevel, label: labels[worstLevel] };
}

async function openVehicleDetail(vehicle) {
  currentVehicle = vehicle;
  showVehicleDetail();
  document.getElementById('detail-truck-name').textContent = vehicle.name;
  document.getElementById('detail-truck-info').textContent = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  document.getElementById('detail-mileage').textContent = vehicle.current_mileage.toLocaleString() + ' miles';
  const history = await fetch(`/api/vehicles?action=history&vehicle_id=${vehicle.id}`).then(r => r.json());
  const issues = await fetch(`/api/vehicles?action=issues&vehicle_id=${vehicle.id}`).then(r => r.json());
  const statusEl = document.getElementById('maintenance-status');
  statusEl.innerHTML = '';
  for (const [service, interval] of Object.entries(MAINTENANCE_INTERVALS)) {
    const last = history.find(h => h.service_type === service);
    const lastMileage = last ? last.mileage_at_service : 0;
    const milesSince = vehicle.current_mileage - lastMileage;
    const milesLeft = interval - milesSince;
    const pct = milesSince / interval;
    let color = '#10b981', statusText = `${milesLeft.toLocaleString()} miles until due`;
    if (pct >= 1) { color = '#ef4444'; statusText = `${Math.abs(milesLeft).toLocaleString()} miles overdue`; }
    else if (pct >= 0.85) { color = '#f59e0b'; }
    const row = document.createElement('div');
    row.className = 'maintenance-row';
    row.innerHTML = `
      <div>
        <div style="font-weight:500;color:#1f2937;">${service}</div>
        <div style="font-size:11px;color:#9ca3af;">Every ${interval.toLocaleString()} miles · Last at ${lastMileage.toLocaleString()}</div>
      </div>
      <div style="font-size:12px;font-weight:600;color:${color};text-align:right;">${statusText}</div>
    `;
    statusEl.appendChild(row);
  }
  const issuesSection = document.getElementById('open-issues-section');
  const issuesList = document.getElementById('open-issues-list');
  if (issues.length > 0) {
    issuesSection.style.display = 'block';
    issuesList.innerHTML = '';
    issues.forEach(issue => {
      const card = document.createElement('div');
      card.className = 'issue-card';
      const date = new Date(issue.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      card.innerHTML = `
        <div class="issue-desc">${issue.description}</div>
        <div class="issue-meta">Reported by ${issue.reported_by} · ${date}</div>
        ${['manager','GM','Owner'].includes(currentUser.role) ? `<button onclick="resolveIssue('${issue.id}')" style="margin-top:8px;background:#0a1f44;color:white;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">Mark resolved</button>` : ''}
      `;
      issuesList.appendChild(card);
    });
  } else {
    issuesSection.style.display = 'none';
  }
}

function showVehiclesHome() {
  document.getElementById('vehicles-home').style.display = 'flex';
  document.getElementById('vehicle-detail').style.display = 'none';
  document.getElementById('vehicle-mileage-form').style.display = 'none';
  document.getElementById('vehicle-service-form').style.display = 'none';
  document.getElementById('vehicle-issue-form').style.display = 'none';
  document.getElementById('vehicle-history').style.display = 'none';
}

function showVehicleDetail() {
  document.getElementById('vehicles-home').style.display = 'none';
  document.getElementById('vehicle-detail').style.display = 'flex';
  document.getElementById('vehicle-mileage-form').style.display = 'none';
  document.getElementById('vehicle-service-form').style.display = 'none';
  document.getElementById('vehicle-issue-form').style.display = 'none';
  document.getElementById('vehicle-history').style.display = 'none';
}

function showUpdateMileage() {
  document.getElementById('mileage-form-current').textContent = currentVehicle.current_mileage.toLocaleString();
  document.getElementById('new-mileage-input').value = '';
  document.getElementById('vehicles-home').style.display = 'none';
  document.getElementById('vehicle-detail').style.display = 'none';
  document.getElementById('vehicle-mileage-form').style.display = 'flex';
}

function showLogService() {
  document.getElementById('service-mileage-input').value = currentVehicle.current_mileage;
  document.getElementById('service-notes-input').value = '';
  document.getElementById('service-type-select').value = '';
  document.getElementById('vehicles-home').style.display = 'none';
  document.getElementById('vehicle-detail').style.display = 'none';
  document.getElementById('vehicle-service-form').style.display = 'flex';
}

function showReportIssue() {
  document.getElementById('issue-description-input').value = '';
  document.getElementById('vehicles-home').style.display = 'none';
  document.getElementById('vehicle-detail').style.display = 'none';
  document.getElementById('vehicle-issue-form').style.display = 'flex';
}

async function showServiceHistory() {
  document.getElementById('history-title').textContent = `${currentVehicle.name} — Service history`;
  document.getElementById('vehicles-home').style.display = 'none';
  document.getElementById('vehicle-detail').style.display = 'none';
  document.getElementById('vehicle-history').style.display = 'flex';
  const history = await fetch(`/api/vehicles?action=history&vehicle_id=${currentVehicle.id}`).then(r => r.json());
  const list = document.getElementById('history-list');
  if (!history.length) { list.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:13px;padding:20px;">No service records yet.</div>'; return; }
  list.innerHTML = '';
  history.forEach(h => {
    const date = new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="history-type">${h.service_type}</div>
      <div class="history-meta">${h.mileage_at_service.toLocaleString()} miles · ${h.logged_by} · ${date}</div>
      ${h.notes ? `<div class="history-notes">${h.notes}</div>` : ''}
    `;
    list.appendChild(card);
  });
}

async function submitMileageUpdate() {
  const mileage = parseInt(document.getElementById('new-mileage-input').value);
  if (!mileage || mileage < currentVehicle.current_mileage) { alert('Please enter a valid mileage higher than the current reading.'); return; }
  await fetch('/api/vehicles?action=update_mileage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle_id: currentVehicle.id, mileage })
  });
  currentVehicle.current_mileage = mileage;
  alert('Mileage updated!');
  openVehicleDetail(currentVehicle);
}

async function submitServiceLog() {
  const service_type = document.getElementById('service-type-select').value;
  const mileage_at_service = parseInt(document.getElementById('service-mileage-input').value);
  const notes = document.getElementById('service-notes-input').value.trim();
  if (!service_type || !mileage_at_service) { alert('Please select a service type and enter the mileage.'); return; }
  await fetch('/api/vehicles?action=log_service', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle_id: currentVehicle.id, service_type, mileage_at_service, notes, logged_by: currentUser.name })
  });
  currentVehicle.current_mileage = mileage_at_service;
  alert('Service logged!');
  openVehicleDetail(currentVehicle);
}

async function submitIssueReport() {
  const description = document.getElementById('issue-description-input').value.trim();
  if (!description) { alert('Please describe the issue.'); return; }
  await fetch('/api/vehicles?action=report_issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle_id: currentVehicle.id, description, reported_by: currentUser.name })
  });
  alert('Issue reported!');
  openVehicleDetail(currentVehicle);
}

async function resolveIssue(issue_id) {
  if (!confirm('Mark this issue as resolved?')) return;
  await fetch('/api/vehicles?action=resolve_issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ issue_id })
  });
  openVehicleDetail(currentVehicle);
}
