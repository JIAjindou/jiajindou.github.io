$(document).ready(function() {
    setupPublicationFilters();
    setupVideoToggles();
    setupNewsToggle();
    setupPreprintToggle();
    pingVisitor();
    setupVisitorGlobe();
    setupOwnerPanel();
});

// Record this visit with the Cloudflare Worker (once per browser session).
// The Worker reads the visitor's approximate lat/lon from Cloudflare's edge
// (request.cf) — the page only sends the referrer (which site linked here).
function pingVisitor() {
    var url = window.VISITOR_WORKER_URL;
    if (!url) return;
    try { if (sessionStorage.getItem('mv_pinged')) return; } catch (e) {}
    var ref = '';
    try { ref = document.referrer || ''; } catch (e) {}
    fetch(url.replace(/\/$/, '') + '/collect?ref=' + encodeURIComponent(ref),
        { method: 'POST', mode: 'cors', keepalive: true }).catch(function () {});
    try { sessionStorage.setItem('mv_pinged', '1'); } catch (e) {}
}

// Owner-only visitor log. Hidden from the public: it only activates when you
// visit the site with the #owner hash. Prompts for the key set on the Worker,
// fetches the private detail log, and shows it in an overlay table.
function setupOwnerPanel() {
    var url = window.VISITOR_WORKER_URL;
    if (!url) return;
    if ((location.hash || '').toLowerCase() !== '#owner') return;

    var key = '';
    try { key = sessionStorage.getItem('mv_key') || ''; } catch (e) {}
    if (!key) key = window.prompt('Owner key:') || '';
    if (!key) return;

    fetch(url.replace(/\/$/, '') + '/log?key=' + encodeURIComponent(key), { mode: 'cors' })
        .then(function (r) {
            if (r.status === 401) {
                try { sessionStorage.removeItem('mv_key'); } catch (e) {}
                alert('Wrong owner key.');
                return null;
            }
            return r.ok ? r.json() : null;
        })
        .then(function (log) {
            if (!log) return;
            try { sessionStorage.setItem('mv_key', key); } catch (e) {}
            renderOwnerLog(log);
        })
        .catch(function () {});
}

function ownerBrowser(ua) {
    ua = ua || '';
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Other';
}

function renderOwnerLog(log) {
    var overlay = document.createElement('div');
    overlay.className = 'owner-overlay';

    var rows = log.map(function (e) {
        var t = (e.ts || '').replace('T', ' ').replace(/\..*$/, '').replace('Z', ' UTC');
        var place = [e.city, e.region, e.country].filter(Boolean).join(', ');
        var ref = e.ref ? e.ref.replace(/^https?:\/\//, '') : '—';
        return '<tr><td>' + t + '</td><td>' + (place || '—') + '</td><td>' + ref +
            '</td><td>' + ownerBrowser(e.ua) + '</td></tr>';
    }).join('');

    overlay.innerHTML =
        '<div class="owner-card">' +
        '<div class="owner-head"><b>Visitor log</b> <span>(' + log.length + ' most recent)</span>' +
        '<button class="owner-close" type="button">&times;</button></div>' +
        '<div class="owner-table-wrap"><table class="owner-table"><thead><tr>' +
        '<th>Time (UTC)</th><th>Location</th><th>From</th><th>Browser</th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="4">No records yet.</td></tr>') +
        '</tbody></table></div></div>';

    function close() { overlay.remove(); if (location.hash) history.replaceState(null, '', location.pathname); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.owner-close').addEventListener('click', close);
    document.body.appendChild(overlay);
}

// "Where are my visitors?" — a collapsed 3D globe that lazy-loads globe.gl
// and the aggregated visitor points only when the button is first clicked.
function setupVisitorGlobe() {
    var url = window.VISITOR_WORKER_URL;
    var btn = document.getElementById('globe-toggle');
    var box = document.getElementById('globe-box');
    var stats = document.getElementById('globe-stats');
    if (!url || !btn || !box) return;
    var loaded = false, world = null;

    function sizeGlobe() {
        if (world) { world.width(box.clientWidth).height(box.clientHeight); }
    }

    btn.addEventListener('click', function () {
        if (!box.hidden) {
            box.hidden = true;
            if (stats) stats.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
            btn.textContent = '🌍 Where are my visitors?';
            return;
        }
        box.hidden = false;
        if (stats) stats.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = '✕ Hide visitor map';
        if (loaded) { sizeGlobe(); return; }
        loaded = true;
        box.innerHTML = '<p class="globe-loading">Loading globe…</p>';

        loadScript('/js/globe.gl.min.js', function () {
            box.innerHTML = '';
            // Vendor-only, no external CDN/texture (works in mainland China):
            // a flat light-blue sphere with dotted continents (hex polygons),
            // graticules and atmosphere — plus our own city-level visitor dots.
            fetch('/data/countries.geojson')
                .then(function (r) { return r.ok ? r.json() : { features: [] }; })
                .catch(function () { return { features: [] }; })
                .then(function (countries) {
                    world = Globe()(box)
                        .backgroundColor('rgba(0,0,0,0)')
                        .globeImageUrl(null)
                        .showGraticules(true)
                        .showAtmosphere(true)
                        .atmosphereColor('#acd6ef')
                        .atmosphereAltitude(0.2)
                        .hexPolygonsData((countries && countries.features) || [])
                        .hexPolygonResolution(3)
                        .hexPolygonMargin(0.32)
                        .hexPolygonUseDots(true)
                        .hexPolygonColor(function () { return 'rgba(38,88,148,0.8)'; })
                        .pointAltitude(function (d) { return Math.min(0.04 + Math.log(d.count + 1) * 0.03, 0.4); })
                        .pointColor(function () { return '#ff4d4f'; })
                        .pointRadius(0.5)
                        .pointLabel(function (d) { return (d.city ? d.city + ', ' : '') + (d.country || '') + ' — ' + d.count + (d.count > 1 ? ' visits' : ' visit'); });

                    // Light-blue ocean sphere (mutate the existing material).
                    var m = world.globeMaterial();
                    m.color.set('#cfe7f5');
                    m.emissive.set('#2e6bb0');
                    m.emissiveIntensity = 0.10;
                    m.shininess = 6;

                    sizeGlobe();
                    var c = world.controls();
                    c.autoRotate = true;
                    c.autoRotateSpeed = 0.7;
                    c.enableZoom = false;
                    window.addEventListener('resize', sizeGlobe);

                    fetch(url.replace(/\/$/, '') + '/points', { mode: 'cors' })
                        .then(function (r) { return r.ok ? r.json() : []; })
                        .then(function (pts) {
                            pts = pts || [];
                            world.pointsData(pts.map(function (p) {
                                return { lat: p.lat, lng: p.lon, count: p.count, city: p.city, country: p.country };
                            }));
                            if (stats) {
                                var total = 0;
                                pts.forEach(function (p) { total += p.count; });
                                stats.textContent = total + (total === 1 ? ' visit' : ' visits') +
                                    ' from ' + pts.length + (pts.length === 1 ? ' place' : ' places');
                            }
                        })
                        .catch(function () {});
                });
        });
    });
}

function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = cb;
    s.onerror = function () {
        var box = document.getElementById('globe-box');
        if (box) box.innerHTML = '<p class="globe-loading">Could not load the globe library.</p>';
    };
    document.body.appendChild(s);
}

// Expand/collapse Preprint entries beyond the first two.
function setupPreprintToggle() {
    var btn = document.querySelector('.preprint-toggle');
    var extra = document.querySelector('.preprint-extra');
    if (!btn || !extra) return;
    btn.addEventListener('click', function() {
        var expanded = extra.classList.toggle('is-expanded');
        btn.textContent = expanded ? 'Show less' : 'Show more';
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
}

// Expand/collapse News items beyond the first 10.
function setupNewsToggle() {
    var btn = document.querySelector('.news-toggle');
    var list = document.querySelector('.news-list');
    if (!btn || !list) return;
    btn.addEventListener('click', function() {
        var expanded = list.classList.toggle('is-expanded');
        btn.textContent = expanded ? 'Show less' : 'Show more';
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
}

// Click-to-play preview videos. Each cell with a clip shows a "▶ Video"
// button; the mp4 is only fetched when the user actually clicks it, so we
// never download videos the visitor doesn't ask for. Click again to swap
// back to the still image. Two-clip entries (data-src2) loop across both.
function setupVideoToggles() {
    document.querySelectorAll('.media-toggle').forEach(function(btn) {
        // The button now lives in the badge row, a sibling of the image
        // cell — walk up to the shared column to find the video/img.
        var column = btn.closest('.column');
        var cell = column ? column.querySelector('.publication-mediacell') : null;
        if (!cell) return;
        var video = cell.querySelector('video');
        var img = cell.querySelector('img');
        if (!video || !img) return;

        var label = btn.querySelector('.media-toggle-label');
        var icon = btn.querySelector('i');

        function setButton(state) {
            // state: 'play' (show video), 'loading', or 'image' (show still)
            if (state === 'loading') {
                icon.className = 'fas fa-spinner fa-spin';
                if (label) label.textContent = 'Loading';
            } else if (state === 'playing') {
                icon.className = 'fas fa-image';
                if (label) label.textContent = 'Image';
            } else {
                icon.className = 'fas fa-play';
                if (label) label.textContent = 'GIF';
            }
        }

        // Reveal the (already-playing) video and hide the still image.
        function revealVideo() {
            video.style.display = 'inline-block';
            img.style.display = 'none';
            cell.classList.add('is-playing');
            setButton('playing');
        }

        function showImage() {
            video.pause();
            video.style.display = 'none';
            img.style.display = '';
            cell.classList.remove('is-playing');
            setButton('play');
        }

        // Chain two clips: src1 ends -> src2 -> src1 -> ... infinite loop.
        // Single-clip videos use the native `loop` attribute, no `ended`.
        video.addEventListener('ended', function() {
            if (!video.dataset.src2) return;
            var playingSecond = video.dataset.playingSecond === '1';
            video.src = playingSecond ? video.dataset.src : video.dataset.src2;
            video.dataset.playingSecond = playingSecond ? '0' : '1';
            var p = video.play();
            if (p && typeof p.catch === 'function') p.catch(function() {});
        });

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            // Already playing -> toggle back to the image.
            if (cell.classList.contains('is-playing')) {
                showImage();
                return;
            }

            setButton('loading');

            // Lazily assign the source on first use. With preload="none",
            // merely setting src does NOT start a download — only play()
            // (or load()) does — so we drive everything off play() below.
            if (video.dataset.src && !video.getAttribute('src')) {
                video.preload = 'auto';
                video.dataset.playingSecond = '0';
                video.src = video.dataset.src;
            }

            // Reveal the moment playback actually begins (first frame is
            // on screen), so there's no white flash and no stuck spinner.
            var onPlaying = function() {
                video.removeEventListener('playing', onPlaying);
                revealVideo();
            };
            video.addEventListener('playing', onPlaying);

            // This click is a user gesture and the video is muted, so
            // play() is allowed and will kick off loading + playback.
            var p = video.play();
            if (p && typeof p.catch === 'function') {
                p.catch(function() {
                    video.removeEventListener('playing', onPlaying);
                    setButton('play');
                });
            }
        });
    });
}

// Publication filter buttons: All / arXiv / Published / Featured.
// Filter is purely client-side — toggles visibility on .publication-block
// elements based on the classes they carry (is-preprint, is-published,
// is-featured), then hides any .pub-section heading whose group ended up
// empty.
function setupPublicationFilters() {
    var buttons = document.querySelectorAll('.pub-filter');
    if (!buttons.length) return;

    function applyFilter(category) {
        document.querySelectorAll('.publication-block').forEach(function(block) {
            var show = (category === 'all') ||
                (category === 'arxiv' && block.classList.contains('is-preprint')) ||
                (category === 'published' && block.classList.contains('is-published')) ||
                (category === 'featured' && block.classList.contains('is-featured'));
            block.style.display = show ? '' : 'none';
        });
        // Hide section wrappers whose group has no visible blocks.
        document.querySelectorAll('.pub-section').forEach(function(sec) {
            var blocks = sec.querySelectorAll('.publication-block');
            var anyVisible = false;
            blocks.forEach(function(b) { if (b.style.display !== 'none') anyVisible = true; });
            sec.style.display = anyVisible ? '' : 'none';
        });
    }

    buttons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            buttons.forEach(function(b) { b.classList.remove('is-active'); });
            btn.classList.add('is-active');
            applyFilter(btn.dataset.filter);
            // Reveal collapsed preprints so filtering shows every match,
            // not just the first two.
            var extra = document.querySelector('.preprint-extra');
            var moreBtn = document.querySelector('.preprint-toggle');
            if (extra) extra.classList.add('is-expanded');
            if (moreBtn) {
                moreBtn.textContent = 'Show less';
                moreBtn.setAttribute('aria-expanded', 'true');
            }
        });
    });
}
