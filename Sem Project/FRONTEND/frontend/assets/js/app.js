// app.js

// 1. JWT Authentication Check
const token = localStorage.getItem("mfp_token");
const userStr = localStorage.getItem("mfp_user");

if (!token || !userStr) {
    window.location = "login.html";
} else {
    try {
        const user = JSON.parse(userStr);
        document.getElementById("userNameDisplay").textContent = user.name || "User";
        document.getElementById("userPill").style.display = "flex";
        
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.role === 'admin') {
            document.getElementById("adminLink").style.display = "inline-flex";
        }
    } catch(e) {}
}

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
    logoutBtn.onclick = () => {
        localStorage.removeItem("mfp_token");
        localStorage.removeItem("mfp_user");
        window.location = "login.html";
    };
}

// 2. Original Map Logic Initialization
let map;
document.addEventListener('DOMContentLoaded', function() {
    try {
        map = L.map('map', { center: [19.5,75.5], zoom:7, zoomControl: false, attributionControl: false });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains:'abcd', maxZoom:19 }).addTo(map);
        L.control.zoom({ position: 'topright' }).addTo(map); // Moved back to right side since right panel is gone!
        setTimeout(() => map.invalidateSize(), 300);
        addCity(); addCity();
    } catch(e) {
        let errDisplay = document.getElementById('errorDisplay');
        if(errDisplay) errDisplay.innerHTML = '⚠️ Map core error';
    }
});

let markers = [], lines = [];
let routeLayers = [];
let routingControl = null;

function clearMap() {
    if(!map) return;
    markers.forEach(m => map.removeLayer(m));
    lines.forEach(l => map.removeLayer(l));
    routeLayers.forEach(l => map.removeLayer(l));
    if (routingControl) map.removeControl(routingControl);
    
    markers = []; lines = []; routeLayers = []; routingControl = null;
    
    let strct = document.getElementById('analysisSplit');
    if(strct) strct.style.display = 'none';
    let pnl = document.getElementById('analyticsHUD');
    let errDisp = document.getElementById('errorDisplay');
    if(errDisp) errDisp.innerHTML = '';
}

function addCity() {
    let container = document.getElementById('inputs');
    if(!container) return;
    let rowId = 'row_' + Date.now() + Math.floor(Math.random() * 100);
    let div = document.createElement('div');
    div.className = 'city-row';
    div.id = rowId;
    div.innerHTML = `
        <div class="autocomplete-wrapper">
            <input type="text" placeholder="Type city or village..." class="city-input" autocomplete="off">
            <div class="autocomplete-dropdown"></div>
        </div>
        <button class="delete-city"><i class="ri-delete-bin-line"></i></button>
    `;
    
    let input = div.querySelector('.city-input');
    let dropdown = div.querySelector('.autocomplete-dropdown');
    
    let debounceTimer;
    input.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        let val = e.target.value;
        div.removeAttribute('data-lat');
        div.removeAttribute('data-lon');
        div.removeAttribute('data-name');
        
        if(val.length < 3) {
            dropdown.style.display = 'none';
            return;
        }
        dropdown.innerHTML = `<div style="padding:15px; color: #a0a0a0; font-size:12px; text-align:center;"><i class="ri-loader-4-line ri-spin"></i> Searching OpenStreetMap...</div>`;
        dropdown.style.display = 'block';
        
        debounceTimer = setTimeout(async () => {
            try {
                let res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&addressdetails=1&limit=5`);
                let data = await res.json();
                dropdown.innerHTML = '';
                if(data.length === 0) {
                    dropdown.innerHTML = `<div style="padding:15px; color: #ef4444; font-size:12px; text-align:center;">No results found.</div>`;
                    return;
                }
                
                data.forEach(item => {
                    let type = item.type || item.class;
                    let address = item.address || {};
                    let icon = type === 'city' ? 'ri-building-2-line' : (type === 'village' ? 'ri-home-smile-line' : 'ri-map-pin-line');
                    let state = address.state || address.county || '';
                    let country = address.country || '';
                    let title = address.city || address.town || address.village || item.name;
                    
                    let itemDiv = document.createElement('div');
                    itemDiv.className = 'autocomplete-item';
                    itemDiv.innerHTML = `
                        <i class="${icon} ac-icon"></i>
                        <div class="ac-text">
                            <span class="ac-main">${title}</span>
                            <span class="ac-sub" style="text-transform:capitalize;">${type} • ${state ? state+', ' : ''}${country}</span>
                        </div>
                    `;
                    itemDiv.onclick = () => {
                        input.value = title;
                        div.dataset.lat = item.lat;
                        div.dataset.lon = item.lon;
                        div.dataset.name = title;
                        dropdown.style.display = 'none';
                        updateSelects();
                        highlightOnMap(item.lat, item.lon, title, type);
                    };
                    dropdown.appendChild(itemDiv);
                });
            } catch(err) {
                 dropdown.innerHTML = `<div style="padding:15px; color: #ef4444; font-size:12px; text-align:center;">Search failed.</div>`;
            }
        }, 500);
    });

    document.addEventListener('click', (e) => {
        if(!div.contains(e.target)) dropdown.style.display = 'none';
    });

    div.querySelector('.delete-city').onclick = () => { div.remove(); updateSelects(); };
    container.appendChild(div);
}

function highlightOnMap(lat, lon, title, type) {
    if(!map) return;
    let m = L.circleMarker([lat, lon], {
        radius: 8, fillColor: "#3b82f6", color: "#ffffff", weight: 2, opacity: 1, fillOpacity: 1
    }).addTo(map);
    m.bindTooltip(title, {direction: "top", className: "city-label-map", offset: [0, -12]});
    
    map.flyTo([lat, lon], 10, {animate: true, duration: 1});
    markers.push(m);
}

function updateSelects() {
    let validRows = document.querySelectorAll('#inputs .city-row');
    let names = [];
    validRows.forEach(row => { if(row.dataset.name) names.push(row.dataset.name); });
    
    let s = document.getElementById('start');
    let e = document.getElementById('end');
    if(!s || !e) return;
    s.innerHTML = '<option value="">Select start</option>';
    e.innerHTML = '<option value="">Select end</option>';
    names.forEach(n => { s.add(new Option(n,n)); e.add(new Option(n,n)); });
}

function haversine(lat1,lon1,lat2,lon2) {
    const R = 6371;
    let dLat = (lat2-lat1)*Math.PI/180;
    let dLon = (lon2-lon1)*Math.PI/180;
    let a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function greedy(m, start, end) {
    let n = m.length, vis = Array(n).fill(false), path = [start];
    vis[start] = true;
    let cur = start;
    while(true) {
        let next = -1, best = Infinity;
        for(let i=0; i<n; i++) {
            if(!vis[i] && (start!=end ? i!=end : true) && m[cur][i] < best) {
                best = m[cur][i];
                next = i;
            }
        }
        if(next==-1) break;
        vis[next]=true;
        path.push(next);
        cur = next;
    }
    if(start != end) path.push(end);
    else if(path[path.length-1] != start) path.push(start);
    return path;
}

function tspDP(m, start, end) {
    let n = m.length, dp = {}, parent = {}, VIS = 1<<n;
    for(let mask=0; mask<VIS; mask++) for(let i=0; i<n; i++) dp[mask+','+i] = Infinity;
    dp[(1<<start)+','+start] = 0;
    for(let mask=0; mask<VIS; mask++) {
        for(let u=0; u<n; u++) {
            let key = mask+','+u;
            if(dp[key]===Infinity) continue;
            for(let v=0; v<n; v++) {
                if(mask & (1<<v)) continue;
                let nextMask = mask | (1<<v);
                let newCost = dp[key] + m[u][v];
                let k = nextMask+','+v;
                if(newCost < dp[k]) {
                    dp[k] = newCost;
                    parent[k] = u+','+mask;
                }
            }
        }
    }
    let finalMask = VIS-1, best = Infinity, last = -1;
    if(start == end && n > 1) {
        for(let i=0; i<n; i++) {
            if(i==start) continue;
            let cost = dp[finalMask+','+i] + m[i][start];
            if(cost<best) { best=cost; last=i; }
        }
    } else {
        for(let i=0; i<n; i++) {
            let cost = dp[finalMask+','+i] + m[i][end];
            if(cost<best) { best=cost; last=i; }
        }
    }
    let path = (start==end) ? [start] : [end];
    let mask = finalMask, cur = last;
    while(cur != start && cur != -1) {
        path.unshift(cur);
        let pStr = parent[mask+','+cur];
        if(!pStr) break;
        let p = pStr.split(',');
        cur = parseInt(p[0]);
        mask = parseInt(p[1]);
    }
    if(path[0] !== start) path.unshift(start);
    if(start==end && path[path.length-1]!=start) path.push(start);
    return path;
}

async function getRoadRoute(a,b) {
    try {
        let url = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
        let res = await fetch(url);
        let data = await res.json();
        if(data.routes && data.routes[0]) {
             let r = data.routes[0];
             return {
                 coords: r.geometry.coordinates.map(c=>[c[1],c[0]]),
                 distance: r.distance / 1000,
                 duration: r.duration / 60
             };
        }
    } catch(e) {}
    let hdist = haversine(a[0],a[1], b[0],b[1]);
    return {
        coords: [[a[0],a[1]],[b[0],b[1]]],
        distance: hdist,
        duration: Math.floor(hdist*1.2)
    };
}

async function drawRoute(path, coords, color, routeName) {
    let totalRoad = 0;
    let totalAerial = 0;
    let latlngs = [];
    let segmentsData = [];
    
    // Process segments sequentially
    for(let i=0; i<path.length-1; i++) {
        let fromPt = coords[path[i]];
        let toPt = coords[path[i+1]];
        
        let aerialSegment = haversine(fromPt[0], fromPt[1], toPt[0], toPt[1]);
        totalAerial += aerialSegment;
        
        let rd = await getRoadRoute(fromPt, toPt);
        let route = rd.coords;
        if(route.length) {
            let poly = L.polyline(route, {color, weight:6, opacity:0.9}).addTo(map);
            latlngs.push(...route);
            lines.push(poly);
            totalRoad += rd.distance;
            segmentsData.push({fromIdx: path[i], toIdx: path[i+1], distance: rd.distance, duration: rd.duration, aerial: aerialSegment});
        }
    }
    
    let interactionArea = null;
    if (latlngs.length > 0 && routeName) {
        // Creates a thick overlay strictly for catching hover events
        interactionArea = L.polyline(latlngs, {color: 'transparent', weight: 25}).addTo(map);
        lines.push(interactionArea);
    }
    
    return {totalRoad, totalAerial, segmentsData, interactionArea, color, routeName};
}

function displayMatrix(names, m) {
    let el = document.getElementById('matrix');
    if(!el) return;
    let html = "<table><tr><th>City</th>";
    names.forEach(n => html += "<th>"+n+"</th>");
    html += "</tr>";
    for(let i=0; i<names.length; i++) {
        html += "<tr><th>"+names[i]+"</th>";
        for(let j=0; j<names.length; j++) html += "<td>"+m[i][j].toFixed(1)+"</td>";
        html += "</tr>";
    }
    html += "</table>";
    el.innerHTML = html;
}

function drawSVGGraph(svgId, path, names, m) {
    let svg = document.getElementById(svgId);
    if(!svg) return;
    
    document.getElementById('svgContainer').style.display = 'block';
    
    // Attempt to salvage the pre-existing marker if it isn't dynamically built
    let defs = svg.querySelector('defs');
    svg.innerHTML = '';
    if(!defs) {
        defs = document.createElementNS("http://www.w3.org/2000/svg","defs");
    }
    
    // Create perfectly matched geometric color mapping
    let clr = svgId==='graphOptimal' ? "#fb923c" : svgId==='graphGreedy' ? "#10b981" : svgId==='graphTotal' ? "#94a3b8" : "#3b82f6";

    // Setup arrow marker dynamically so colors strictly pair identically!
    let markerId = "arrow-" + svgId;
    let marker = document.createElementNS("http://www.w3.org/2000/svg","marker");
    marker.setAttribute("id", markerId);
    marker.setAttribute("markerWidth", "12");
    marker.setAttribute("markerHeight", "12");
    marker.setAttribute("refX", "34"); // Push arrow exactly behind radius 28!
    marker.setAttribute("refY", "6");
    marker.setAttribute("orient", "auto");
    
    let pathArrow = document.createElementNS("http://www.w3.org/2000/svg","polyline");
    pathArrow.setAttribute("points", "0,0 8,6 0,12");
    pathArrow.setAttribute("fill", "none");
    pathArrow.setAttribute("stroke", clr);
    pathArrow.setAttribute("stroke-width", "3");
    marker.appendChild(pathArrow);
    defs.innerHTML = ''; 
    defs.appendChild(marker);
    svg.appendChild(defs);

    let n = path.length;
    let cols = Math.ceil(Math.sqrt(n));
    if (cols < 2 && n > 1) cols = 2; // Keep at least 2 columns forming for grid shapes
    
    let cellW = 220; 
    let cellH = 140; 
    
    let positions = [];
    let maxX = 0; let maxY = 0;
    
    for(let i=0; i<n; i++) {
        let col = i % cols;
        let row = Math.floor(i / cols);
        let x = col * cellW;
        let y = row * cellH;
        positions.push([x, y]);
        
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    // Set an ultra-tight bounding box so viewport naturally scales geometric coordinates up!
    let padX = 140; 
    let padY = 120;
    svg.setAttribute("viewBox", `-70 -50 ${maxX + padX} ${maxY + padY}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    for(let i=0; i<path.length-1; i++) {
        let f = positions[path[i]];
        let t = positions[path[i+1]];
        if(!f || !t) continue;
        
        let line = document.createElementNS("http://www.w3.org/2000/svg","line");
        line.setAttribute("x1",f[0]); line.setAttribute("y1",f[1]);
        line.setAttribute("x2",t[0]); line.setAttribute("y2",t[1]);
        line.setAttribute("stroke", clr);
        line.setAttribute("stroke-width", "4");
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("marker-end", `url(#${markerId})`);
        svg.appendChild(line);

        let lbl = document.createElementNS("http://www.w3.org/2000/svg","text");
        lbl.setAttribute("x",(f[0]+t[0])/2); 
        lbl.setAttribute("y",(f[1]+t[1])/2 - 16);
        lbl.setAttribute("fill", "#cbd5e1");
        lbl.setAttribute("font-size", "16");
        lbl.setAttribute("font-weight", "600");
        lbl.setAttribute("font-family", "'Outfit'");
        lbl.setAttribute("text-anchor", "middle");
        lbl.textContent = m[path[i]][path[i+1]].toFixed(1)+" km";
        svg.appendChild(lbl);
    }

    for(let i=0; i<path.length; i++) {
        let p = positions[path[i]];
        if(!p) continue;
        
        let circ = document.createElementNS("http://www.w3.org/2000/svg","circle");
        circ.setAttribute("cx", p[0]); 
        circ.setAttribute("cy", p[1]); 
        circ.setAttribute("r", "28");
        circ.setAttribute("fill", "#121826");
        circ.setAttribute("stroke", clr);
        circ.setAttribute("stroke-width", "4");
        svg.appendChild(circ);

        let txt = document.createElementNS("http://www.w3.org/2000/svg","text");
        txt.setAttribute("x", p[0]); 
        txt.setAttribute("y", p[1] + 55);
        txt.setAttribute("fill", "#f8fafc"); 
        txt.setAttribute("font-family", "'Outfit'");
        txt.setAttribute("font-size", "18"); 
        txt.setAttribute("font-weight", "800");
        txt.setAttribute("text-anchor", "middle");
        txt.textContent = names[path[i]];
        svg.appendChild(txt);

        let step = document.createElementNS("http://www.w3.org/2000/svg","text");
        step.setAttribute("x", p[0]); 
        step.setAttribute("y", p[1] + 6); // Centered mathematically inside circle radius
        step.setAttribute("fill", "#ffffff"); 
        step.setAttribute("font-size", "18");
        step.setAttribute("font-family", "'Inter'");
        step.setAttribute("font-weight", "800"); 
        step.setAttribute("text-anchor", "middle");
        step.textContent = i+1;
        svg.appendChild(step);
    }
}

// FORMAT TIME HELPER
function formatTime(mins) {
    if(!mins || mins===0) return "Unknown";
    let h = Math.floor(mins/60);
    let m = Math.floor(mins%60);
    return (h>0 ? h+"h " : "") + m+"m";
}

// COMPACT BREAKDOWN GENERATOR CARD
function renderBreakdown(segmentsData, names, totalDist, title, color, icon) {
    let container = document.getElementById("breakdownContainer");
    
    let html = `
        <div class="route-card glass-panel" style="padding: 24px; border: 1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <div>
                   <h3 style="font-size:18px; color:${color}; font-weight:700; display:flex; gap:8px; align-items:center;"><i class="${icon}"></i> ${title}</h3>
                </div>
                <div style="text-align:right;">
                   <div style="font-size:24px; font-weight:800; font-family:'Outfit'; color:#fff;">${totalDist.toFixed(1)} km</div>
                </div>
            </div>
            
            <div style="margin-top:20px; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px;">
    `;
    
    let totalMins = 0;
    segmentsData.forEach((seg, idx) => {
        let fromName = names[seg.fromIdx];
        let toName = names[seg.toIdx];
        totalMins += seg.duration;
        
        html += `
            <div class="route-leg" style="padding:12px 0;">
                <div style="width: 30px; font-size:15px; font-weight:bold; color:var(--text-muted); font-family:'Outfit';">#${idx+1}</div>
                <div style="flex:1;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                         <span style="font-weight:600; color:#f8fafc; font-size:14px;">${fromName}</span>
                         <i class="ri-arrow-right-line" style="color:var(--brand-secondary); font-size:13px;"></i>
                         <span style="font-weight:600; color:#f8fafc; font-size:14px;">${toName}</span>
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:15px; font-weight:700; color:#fff; font-family:'Outfit';">${seg.distance.toFixed(1)} km</div>
                    <div style="font-size:12px; color:#94a3b8; margin-top:2px;"><i class="ri-timer-line"></i> ${formatTime(seg.duration)}</div>
                </div>
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
    `;
    container.innerHTML = html;
}

// MAIN RUN FUNCTION
async function run() {
    if(!map) { alert("Map loading..."); return; }
    
    let validRows = document.querySelectorAll('#inputs .city-row');
    let coords = [];
    let names = [];
    
    validRows.forEach(row => {
        let lat = row.dataset.lat;
        let lon = row.dataset.lon;
        let name = row.dataset.name;
        if(lat && lon && name) {
            coords.push([parseFloat(lat), parseFloat(lon)]);
            names.push(name);
        }
    });

    if(names.length < 2) { alert("Please type and select at least 2 valid cities from the precise dropdown suggestions."); return; }

    let startCity = document.getElementById('start').value;
    let endCity = document.getElementById('end').value;
    if(!startCity || !endCity) { alert("Please choose your start and end points via the bottom dropdown filters."); return; }

    clearMap();

    for(let i=0; i<coords.length; i++) {
        let c = coords[i];
        let n = names[i];
        let dot = L.circleMarker(c, {
            radius: 8, fillColor: n===startCity ? "#fb923c" : "#10b981", color: "#ffffff", weight: 2, opacity: 1, fillOpacity: 1
        }).addTo(map);
        dot.bindTooltip(n, {direction: "top", className: "city-label-map", offset: [0, -12]});
        markers.push(dot);
    }
    
    if(coords.length) map.fitBounds(L.latLngBounds(coords), {padding: [50, 50]});

    let straight = [];
    for(let i=0; i<coords.length; i++) {
        straight[i] = [];
        for(let j=0; j<coords.length; j++)
            straight[i][j] = i===j ? 0 : haversine(coords[i][0],coords[i][1], coords[j][0],coords[j][1]);
    }

    displayMatrix(names, straight);

    let sIdx = names.indexOf(startCity);
    let eIdx = names.indexOf(endCity);

    let normal = [...Array(names.length).keys()];
    if(startCity === endCity) normal.push(normal[0]); 
    let greedyPath = greedy(straight, sIdx, eIdx);
    let optimalPath = tspDP(straight, sIdx, eIdx);

    let errDisp = document.getElementById('errorDisplay');
    if(errDisp) errDisp.innerHTML = '<span class="loading"><i class="ri-loader-4-line ri-spin"></i> Processing matrix vectors...</span>';

    // Different colors for different strategies
    let r1 = await drawRoute(normal, coords, '#475569', 'Original Order (Base)');
    let r2 = await drawRoute(greedyPath, coords, '#10b981', 'Fastest Path Logic');
    let r3 = await drawRoute(optimalPath, coords, '#fb923c', 'Recommended Route');

    if(errDisp) errDisp.innerHTML = '';
    
    let d1 = r1.totalRoad, d2 = r2.totalRoad, d3 = r3.totalRoad;
    let best = Math.min(d1,d2,d3);
    let bestName = best===d1 ? 'Original Flow' : best===d2 ? 'Fastest Path' : 'Recommended Optimal';

    // REVEAL BOTTOM HUD SECTIONS
    document.getElementById('analysisSplit').style.display = 'block';
    document.getElementById('analyticsHUD').style.display = 'block';

    let compareEl = document.getElementById('compare');
    if (compareEl) {
        compareEl.innerHTML = `
            <div style="padding:16px; background:rgba(255,195,113,0.1); border:1px solid rgba(251,146,60,0.5); border-radius:12px; height:100%; display:flex; flex-direction:column; justify-content:center;">
                <span style="font-size:13px; color:var(--brand-secondary); text-transform:uppercase; font-weight:700;">🏆 Best Logic Determined:</span>
                <b style="color:#fff; font-size:24px; font-family:'Outfit'; margin-top:5px;">${bestName}</b> 
                <span style="font-size:12px; color:#a0a0a0; margin-top:8px;">Comparing mapping topological data.</span>
            </div>
        `;
    }

    let predictionEl = document.getElementById('prediction');
    if (predictionEl) {
        predictionEl.innerHTML = `
            <div style="background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.05); padding:18px; border-radius:12px; height:100%; display:flex; flex-direction:column; justify-content:center;">
                <div style="font-size:14px; color:#cbd5e1; display:flex; justify-content:space-between; margin-bottom:10px;">
                    <span>Smart Suggested Distance:</span>
                    <b style="color:#10b981;">${best.toFixed(1)} km</b>
                </div>
                <div style="font-size:14px; color:#cbd5e1; display:flex; justify-content:space-between;">
                    <span>Optimal Aerial Line:</span>
                    <b style="color:#94a3b8;">${straight[sIdx][eIdx].toFixed(1)} km</b>
                </div>
            </div>
        `;
    }

    // DRAW SVGS EXACTLY IN REQUESTED ORDER
    drawSVGGraph('graphGreedy', greedyPath, names, straight);
    drawSVGGraph('graphTotal', normal, names, straight);
    drawSVGGraph('graphOptimal', optimalPath, names, straight);
    
    let finalPathLogic = best===d1 ? normal : best===d2 ? greedyPath : optimalPath;
    drawSVGGraph('graphFinal', finalPathLogic, names, straight);

    let dataToUse, colorToUse, iconToUse;
    if(best === d1) { dataToUse = r1.segmentsData; colorToUse = '#94a3b8'; iconToUse = 'ri-route-line'; }
    else if(best === d2) { dataToUse = r2.segmentsData; colorToUse = '#10b981'; iconToUse = 'ri-flight-takeoff-line'; }
    else { dataToUse = r3.segmentsData; colorToUse = '#fb923c'; iconToUse = 'ri-copper-diamond-line'; }

    renderBreakdown(dataToUse, names, best, bestName, colorToUse, iconToUse);
    
    // Smooth scroll implicitly down
    document.querySelector('.workspace-layout').scrollIntoView({ behavior: 'smooth' });
}
