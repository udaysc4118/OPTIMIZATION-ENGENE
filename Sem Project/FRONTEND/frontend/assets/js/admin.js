// frontend/assets/js/admin.js

const API_URL = 'http://localhost:5000/api';

const token = localStorage.getItem("mfp_token");
const userStr = localStorage.getItem("mfp_user");

// JWT Validation & Redirection Security
if (!token || !userStr) {
    window.location = "login.html";
} else {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.role !== 'admin') {
            alert("SECURITY: Authorized Personnel Only.\n\nYour standard token has been wiped. Please authenticate via the Admin Gateway.");
            localStorage.removeItem("mfp_token");
            localStorage.removeItem("mfp_user");
            window.location = "login.html";
        } else {
            document.getElementById("commandCenter").style.display = "flex";
            fetchUsers();
        }
    } catch(e) {
        window.location = "login.html";
    }
}

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
    logoutBtn.onclick = () => {
        localStorage.removeItem("mfp_token");
        localStorage.removeItem("mfp_user");
        window.location = "login.html";
    };
}

let allUsers = [];
let filteredUsers = [];
let growthChartInstance = null;

// Pagination and Sorting State
let currentPage = 1;
const ITEMS_PER_PAGE = 8;
let sortCol = 'created_at';
let sortDesc = true;

async function fetchUsers() {
    try {
        const res = await fetch(`${API_URL}/admin/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (!res.ok) {
            if(res.status === 401 || res.status === 403) {
                alert("Session expired or unauthorized credentials detected.");
                localStorage.removeItem("mfp_token");
                window.location = "login.html";
                return;
            }
            throw new Error(data.error || "Failed to fetch operatives");
        }

        allUsers = data.users;
        filteredUsers = [...allUsers]; // Default view
        
        // Calculate Dashboard Telemetry Metrics
        document.getElementById("totalUsersCount").textContent = allUsers.length;
        
        const activeCount = allUsers.filter(u => u.is_active !== false).length; 
        document.getElementById("activeUsersCount").textContent = activeCount;
        
        const suspendedCount = allUsers.length - activeCount;
        document.getElementById("suspendedUsersCount").textContent = suspendedCount;
        
        // Calculate recent logins (last 24 hours)
        const now = new Date();
        const recentLogins = allUsers.filter(u => {
             if(!u.last_login_at) return false;
             let lastLoc = new Date(u.last_login_at);
             let diffHours = Math.abs(now - lastLoc) / 36e5;
             return diffHours <= 24;
        }).length;
        document.getElementById("recentLoginsCount").textContent = recentLogins;

        applySortAndRender();
        buildGrowthChart(allUsers);
    } catch(e) {
        console.error(e);
        alert("Server error connecting to secure database.");
    }
}

// ---------------------------
// SORTING AND PAGINATION LOGIC
// ---------------------------
function handleSort(col) {
    if (sortCol === col) {
        sortDesc = !sortDesc; // Toggle direction
    } else {
        sortCol = col;
        sortDesc = true; // Default to desc on new column
    }
    applySortAndRender();
}

function applySortAndRender() {
    filteredUsers.sort((a, b) => {
        let valA = a[sortCol];
        let valB = b[sortCol];

        if (sortCol === 'is_active') {
             valA = a.is_active !== false ? 1 : 0;
             valB = b.is_active !== false ? 1 : 0;
        }

        if (valA === valB) return 0;
        
        // Handle nulls gracefully during sorting
        if (valA === null || valA === undefined) return sortDesc ? 1 : -1;
        if (valB === null || valB === undefined) return sortDesc ? -1 : 1;

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        return (valA < valB ? -1 : 1) * (sortDesc ? -1 : 1);
    });

    renderTable();
}

function changePage(dir) {
    const maxPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
    currentPage += dir;
    if (currentPage < 1) currentPage = 1;
    if (currentPage > maxPages) currentPage = maxPages;
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById("usersTableBody");
    tbody.innerHTML = "";

    const maxPages = Math.max(1, Math.ceil(filteredUsers.length / ITEMS_PER_PAGE));
    if (currentPage > maxPages) currentPage = maxPages;

    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const currentView = filteredUsers.slice(startIdx, endIdx);

    if (currentView.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color:var(--text-muted);">No records found matching criteria.</td></tr>`;
        updatePaginationUI(maxPages);
        return;
    }

    currentView.forEach(u => {
        let date = new Date(u.created_at).toLocaleDateString(undefined, {
             year: 'numeric', month: 'short', day: 'numeric'
        });
        let lastLog = u.last_login_at ? new Date(u.last_login_at).toLocaleDateString(undefined, {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : "Never";
        let shortId = u.id.split('-')[0].toUpperCase();
        let isActive = u.is_active !== false;
        
        let statusBadge = isActive 
           ? `<span style="background:rgba(16,185,129,0.1); color:#10b981; padding:4px 10px; border-radius:10px; font-size:11px; font-weight:800; text-transform:uppercase;">Active</span>`
           : `<span style="background:rgba(239,68,68,0.1); color:#ef4444; padding:4px 10px; border-radius:10px; font-size:11px; font-weight:800; text-transform:uppercase;">Suspended</span>`;

        let toggleTitle = isActive ? "Suspend Account" : "Activate Account";
        let toggleIcon = isActive ? "ri-shield-keyhole-line" : "ri-shield-check-line";
        let toggleColor = isActive ? "#fb923c" : "#10b981";

        let tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
        tr.innerHTML = `
            <td style="padding:15px; font-family:'Outfit'; font-weight:600;"><span style="background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:6px; font-size:12px; color:#cbd5e1;">#${shortId}</span></td>
            <td style="padding:15px; font-weight:800; color:#fff;">${u.name}</td>
            <td style="padding:15px; color:#94a3b8; font-size:14px;"><i class="ri-mail-line" style="margin-right:5px; color:var(--brand-primary);"></i>${u.email}</td>
            <td style="padding:15px; color:#cbd5e1; font-size:13px;">${lastLog}</td>
            <td style="padding:15px;">${statusBadge}</td>
            <td style="padding:15px; text-align:right;">
                <button class="action-btn" style="background:transparent; border:none; color:${toggleColor}; font-size:18px; cursor:pointer; margin-right:15px; transition:all 0.3s;" title="${toggleTitle}" onclick="toggleUserStatus('${u.id}', ${!isActive})"><i class="${toggleIcon}"></i></button>
                <button class="action-btn" style="background:transparent; border:none; color:#60a5fa; font-size:18px; cursor:pointer; margin-right:15px; transition:all 0.3s;" title="Modify Details" onclick="openEditModal('${u.id}')"><i class="ri-edit-2-line"></i></button>
                <button class="action-btn" style="background:transparent; border:none; color:#ef4444; font-size:18px; cursor:pointer; transition:all 0.3s;" title="Purge Record" onclick="deleteUser('${u.id}')"><i class="ri-delete-bin-7-line"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updatePaginationUI(maxPages);
}

function updatePaginationUI(maxPages) {
    let pgRow = document.getElementById("paginationRow");
    if (!pgRow) {
        // Create it dynamically if missing
        const tblContainer = document.querySelector(".table-container");
        pgRow = document.createElement("div");
        pgRow.id = "paginationRow";
        pgRow.style.display = "flex";
        pgRow.style.justifyContent = "space-between";
        pgRow.style.alignItems = "center";
        pgRow.style.marginTop = "20px";
        pgRow.style.padding = "10px 15px";
        pgRow.style.background = "rgba(0,0,0,0.2)";
        pgRow.style.borderRadius = "8px";
        tblContainer.appendChild(pgRow);
    }

    pgRow.innerHTML = `
        <div style="font-size: 13px; color: var(--text-muted); font-weight: 600;">
            Showing <span style="color:#fff;">${Math.min(filteredUsers.length, (currentPage-1)*ITEMS_PER_PAGE + 1)}</span> to 
            <span style="color:#fff;">${Math.min(filteredUsers.length, currentPage*ITEMS_PER_PAGE)}</span> of 
            <span style="color:#fff;">${filteredUsers.length}</span> operators
        </div>
        <div style="display:flex; gap: 10px;">
            <button onclick="changePage(-1)" ${currentPage === 1 ? "disabled style='opacity:0.5; cursor:not-allowed;'" : "style='cursor:pointer;'"} class="page-btn"><i class="ri-arrow-left-s-line"></i> Prev</button>
            <div style="padding: 6px 14px; background: rgba(255,255,255,0.05); border-radius: 6px; font-weight: 700;">Page ${currentPage} / ${maxPages}</div>
            <button onclick="changePage(1)" ${currentPage === maxPages ? "disabled style='opacity:0.5; cursor:not-allowed;'" : "style='cursor:pointer;'"} class="page-btn">Next <i class="ri-arrow-right-s-line"></i></button>
        </div>
    `;

    // Add inline styling to dynamically injected buttons
    document.querySelectorAll(".page-btn").forEach(btn => {
        btn.style.background = "rgba(255,255,255,0.1)";
        btn.style.border = "none";
        btn.style.color = "#fff";
        btn.style.padding = "6px 14px";
        btn.style.borderRadius = "6px";
        btn.style.display = "flex";
        btn.style.alignItems = "center";
        btn.style.gap = "5px";
        btn.style.fontWeight = "600";
    });
}

// Ensure columns are clickable for sorting
document.addEventListener("DOMContentLoaded", () => {
    const ths = document.querySelectorAll("th");
    const sortPayloads = ['id', 'name', 'email', 'last_login_at', 'is_active'];
    
    ths.forEach((th, index) => {
        if (index < 5) {
            th.style.cursor = "pointer";
            th.title = "Click to sort";
            th.addEventListener("click", () => handleSort(sortPayloads[index]));
        }
    });
});

// Chart.js - User Growth Initialization
function buildGrowthChart(users) {
    const ctx = document.getElementById('growthChart');
    if (!ctx) return;
    
    // Group users by creation date
    const countsByDate = {};
    users.forEach(u => {
        let dObj = new Date(u.created_at);
        let dStr = `${dObj.getFullYear()}-${(dObj.getMonth()+1).toString().padStart(2,'0')}-${dObj.getDate().toString().padStart(2,'0')}`;
        countsByDate[dStr] = (countsByDate[dStr] || 0) + 1;
    });
    
    // Sort chronologically and create cumulative sum
    let sortedDates = Object.keys(countsByDate).sort();
    let labels = [];
    let dataPoints = [];
    let cumulative = 0;
    
    sortedDates.forEach(date => {
        cumulative += countsByDate[date];
        labels.push(date);
        dataPoints.push(cumulative);
    });

    if (growthChartInstance) growthChartInstance.destroy();

    growthChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.length ? labels : ['No Data'],
            datasets: [{
                label: 'Cumulative Registrations',
                data: dataPoints.length ? dataPoints : [0],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#10b981',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { 
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#cbd5e1',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12
                }
            },
            scales: {
                x: { 
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: { color: '#94a3b8' }
                },
                y: { 
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: { color: '#94a3b8', stepSize: 1 },
                    beginAtZero: true
                }
            }
        }
    });
}

// Search Filter
const userSearch = document.getElementById("userSearch");
if (userSearch) {
    userSearch.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        filteredUsers = allUsers.filter(u => 
            u.name.toLowerCase().includes(query) || 
            u.email.toLowerCase().includes(query) ||
            u.id.toLowerCase().includes(query)
        );
        currentPage = 1; // Reset to page 1 on active search
        applySortAndRender();
    });
}

window.toggleUserStatus = async function(id, suspendState) {
    let msg = suspendState ? "Activate this operative's clearance?" : "Suspend this operative's authentication rights immediately?";
    if(!confirm(msg)) return;

    try {
        const res = await fetch(`${API_URL}/admin/users/${id}/toggle`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ is_active: suspendState })
        });
        
        if (!res.ok) {
            const data = await res.json();
            alert("Error: " + data.error);
            return;
        }

        fetchUsers(); // Pure refresh
    } catch(err) {
        alert("Server error connecting to database during status toggle.");
    }
}

// Modal Logic
const editModal = document.getElementById("editModal");
const closeEditModal = document.getElementById("closeEditModal");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const editForm = document.getElementById("editForm");

function closeEdit() {
    editModal.style.display = "none";
    document.getElementById("editMsg").style.display = "none";
}

if (closeEditModal) closeEditModal.onclick = (e) => { e.preventDefault(); closeEdit(); };
if (cancelEditBtn) cancelEditBtn.onclick = (e) => { e.preventDefault(); closeEdit(); };

window.openEditModal = function(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    
    document.getElementById("editUserId").value = user.id;
    document.getElementById("editName").value = user.name;
    document.getElementById("editEmail").value = user.email;
    document.getElementById("editMsg").style.display = "none";
    
    editModal.style.display = "flex";
}

if (editForm) {
    editForm.onsubmit = async (e) => {
        e.preventDefault();
        
        const id = document.getElementById("editUserId").value;
        const name = document.getElementById("editName").value.trim();
        const email = document.getElementById("editEmail").value.trim();
        const msg = document.getElementById("editMsg");
        const submitBtn = editForm.querySelector('button[type="submit"]');

        msg.style.display = "none";
        
        if (!name || !email) {
            msg.textContent = "All fields required.";
            msg.className = "error-badge";
            msg.style.display = "block";
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = "<i class='ri-loader-4-line ri-spin'></i> Saving...";

        try {
            const res = await fetch(`${API_URL}/admin/users/${id}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ name, email })
            });

            const data = await res.json();
            
            if (!res.ok) {
                msg.textContent = data.error || "Update failed";
                msg.className = "error-badge";
                msg.style.display = "block";
                submitBtn.disabled = false;
                submitBtn.innerHTML = "<i class='ri-save-line'></i> Save Changes";
                return;
            }

            msg.textContent = "Operative metadata patched successfully!";
            msg.className = "success-badge";
            msg.style.display = "block";
            
            fetchUsers(); // Refresh background table

            setTimeout(() => {
                closeEdit();
                submitBtn.disabled = false;
                submitBtn.innerHTML = "<i class='ri-save-line'></i> Save Changes";
            }, 1000);
            
        } catch(err) {
            msg.textContent = "Connection error.";
            msg.className = "error-badge";
            msg.style.display = "block";
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<i class='ri-save-line'></i> Save Changes";
        }
    };
}

window.deleteUser = async function(id) {
    if(!confirm("Are you absolutely sure you want to completely expunge this operative's data? This action is permanent and cannot be undone.")) return;

    try {
        const res = await fetch(`${API_URL}/admin/users/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) {
            const data = await res.json();
            alert("Error: " + data.error);
            return;
        }

        let oldDisplay = document.getElementById("totalUsersCount").textContent;
        document.getElementById("totalUsersCount").textContent = "Purged";
        setTimeout(() => document.getElementById("totalUsersCount").textContent = oldDisplay - 1, 1500);
        
        fetchUsers();
    } catch(err) {
        alert("Server error connecting to database.");
    }
}
