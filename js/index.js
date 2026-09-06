$(document).ready(function() {
    setupPublicationFilters();
    setupVideoToggles();
    setupNewsToggle();
    setupPreprintToggle();
    pingVisitor();
    setupVisitorGlobe();
});

// Record this visit with the Cloudflare Worker (once per browser session).
// The Worker reads the visitor's approximate lat/lon from Cloudflare's edge
// (request.cf) — no data is sent from the page itself.
function pingVisitor() {
    var url = window.VISITOR_WORKER_URL;
    if (!url) return;
    try { if (sessionStorage.getItem('mv_pinged')) return; } catch (e) {}
    fetch(url.replace(/\/$/, '') + '/collect', { method: 'POST', mode: 'cors', keepalive: true }).catch(function () {});
    try { sessionStorage.setItem('mv_pinged', '1'); } catch (e) {}
}

// "Where are my visitors?" — a collapsed 3D globe that lazy-loads globe.gl
// and the aggregated visitor points only when the button is first clicked.
function setupVisitorGlobe() {
    var url = window.VISITOR_WORKER_URL;
    var btn = document.getElementById('globe-toggle');
    var box = document.getElementById('globe-box');
    if (!url || !btn || !box) return;
    var loaded = false, world = null;

    function sizeGlobe() {
        if (world) { world.width(box.clientWidth).height(box.clientHeight); }
    }

    btn.addEventListener('click', function () {
        if (!box.hidden) {
            box.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
            btn.textContent = '🌍 Where are my visitors?';
            return;
        }
        box.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = '✕ Hide visitor map';
        if (loaded) { sizeGlobe(); return; }
        loaded = true;
        box.innerHTML = '<p class="globe-loading">Loading globe…</p>';

        loadScript('https://cdn.jsdelivr.net/npm/globe.gl@2/dist/globe.gl.min.js', function () {
            box.innerHTML = '';
            world = Globe()(box)
                .backgroundColor('rgba(0,0,0,0)')
                .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg')
                .pointsMerge(true)
                .pointAltitude(function (d) { return Math.min(0.04 + Math.log(d.count + 1) * 0.03, 0.4); })
                .pointColor(function () { return '#12b5b0'; })
                .pointRadius(0.55)
                .pointLabel(function (d) { return (d.city ? d.city + ', ' : '') + (d.country || '') + ' — ' + d.count + (d.count > 1 ? ' visits' : ' visit'); });
            sizeGlobe();
            world.controls().autoRotate = true;
            world.controls().autoRotateSpeed = 0.6;

            fetch(url.replace(/\/$/, '') + '/points', { mode: 'cors' })
                .then(function (r) { return r.ok ? r.json() : []; })
                .then(function (pts) {
                    world.pointsData((pts || []).map(function (p) {
                        return { lat: p.lat, lng: p.lon, count: p.count, city: p.city, country: p.country };
                    }));
                })
                .catch(function () {});
        });

        window.addEventListener('resize', sizeGlobe);
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
