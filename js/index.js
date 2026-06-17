$(document).ready(function() {
    loadCitationCounts();
    setupPublicationFilters();
    setupVideoToggles();
});

// Click-to-play preview videos. Each cell with a clip shows a "▶ Video"
// button; the mp4 is only fetched when the user actually clicks it, so we
// never download videos the visitor doesn't ask for. Click again to swap
// back to the still image. Two-clip entries (data-src2) loop across both.
function setupVideoToggles() {
    document.querySelectorAll('.publication-mediacell').forEach(function(cell) {
        var video = cell.querySelector('video');
        var img = cell.querySelector('img');
        var btn = cell.querySelector('.media-toggle');
        if (!video || !btn) return;

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
                if (label) label.textContent = 'Video';
            }
        }

        function showVideo() {
            video.style.display = 'inline-block';
            img.style.display = 'none';
            cell.classList.add('is-playing');
            setButton('playing');
            var p = video.play();
            if (p && typeof p.catch === 'function') p.catch(function() {});
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

            // First click: lazily assign src and wait for the first frame
            // so we never flash a white blank.
            if (video.dataset.src && !video.src) {
                setButton('loading');
                video.dataset.playingSecond = '0';
                video.src = video.dataset.src;
                video.addEventListener('loadeddata', function onReady() {
                    video.removeEventListener('loadeddata', onReady);
                    showVideo();
                });
                video.addEventListener('error', function onErr() {
                    video.removeEventListener('error', onErr);
                    setButton('play');
                });
            } else if (video.readyState >= 2) {
                showVideo();
            } else {
                setButton('loading');
                video.addEventListener('loadeddata', function onReady() {
                    video.removeEventListener('loadeddata', onReady);
                    showVideo();
                });
            }
        });
    });
}

// Fetch citation counts from Semantic Scholar and fill in .citation-badge
// spans. Cached in localStorage. Priority: DOI -> arXiv ID -> title.
// Each request gets one auto-retry; the API is flaky from some networks.
function loadCitationCounts() {
    var badges = document.querySelectorAll('.citation-badge');
    var HIT_TTL = 7 * 24 * 60 * 60 * 1000;   // 7 days for successful hits
    var MISS_TTL = 6 * 60 * 60 * 1000;        // 6 hours for failures (so we re-try sooner)
    var BASE = 'https://api.semanticscholar.org/graph/v1/paper/';
    var queue = Array.prototype.slice.call(badges);

    function fetchWithRetry(url, attempt) {
        return fetch(url).then(function(r) {
            // Retry once on rate-limit or transient server error.
            if ((r.status === 429 || r.status >= 500) && (attempt || 0) < 1) {
                return new Promise(function(res) { setTimeout(res, 1200); })
                    .then(function() { return fetchWithRetry(url, (attempt || 0) + 1); });
            }
            return r;
        });
    }

    function tryTitleSearch(badge) {
        if (!badge.dataset.title) return Promise.resolve(null);
        return fetchWithRetry(BASE + 'search?query=' + encodeURIComponent(badge.dataset.title) + '&limit=1&fields=citationCount')
            .then(function(r) { return r && r.ok ? r.json() : null; });
    }

    function next() {
        var badge = queue.shift();
        if (!badge) return;

        var url, cacheKey, lookupKind;
        if (badge.dataset.doi) {
            url = BASE + 'DOI:' + encodeURIComponent(badge.dataset.doi) + '?fields=citationCount';
            cacheKey = 'ss_doi:' + badge.dataset.doi;
            lookupKind = 'doi';
        } else if (badge.dataset.arxiv) {
            url = BASE + 'arXiv:' + encodeURIComponent(badge.dataset.arxiv) + '?fields=citationCount';
            cacheKey = 'ss_arxiv:' + badge.dataset.arxiv;
            lookupKind = 'arxiv';
        } else if (badge.dataset.title) {
            url = BASE + 'search?query=' + encodeURIComponent(badge.dataset.title) + '&limit=1&fields=citationCount';
            cacheKey = 'ss_title:' + badge.dataset.title;
            lookupKind = 'title';
        } else {
            setTimeout(next, 0);
            return;
        }

        var cached = null;
        try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) {}
        if (cached) {
            var ttl = cached.count != null ? HIT_TTL : MISS_TTL;
            if ((Date.now() - cached.ts) < ttl) {
                if (cached.count > 0) renderCitationBadge(badge, cached.count);
                setTimeout(next, cached.count != null ? 0 : 200);
                return;
            }
        }

        fetchWithRetry(url)
            .then(function(r) {
                if (!r) return null;
                // Direct lookup failed (404, 403, etc.) — try title search as fallback.
                if (!r.ok && lookupKind !== 'title') {
                    return tryTitleSearch(badge);
                }
                return r.ok ? r.json() : null;
            })
            .then(function(data) {
                var count;
                if (data) {
                    count = (data.data && data.data[0] && data.data[0].citationCount);
                    if (typeof count !== 'number') count = data.citationCount;
                }
                if (typeof count === 'number') {
                    try { localStorage.setItem(cacheKey, JSON.stringify({ count: count, ts: Date.now() })); } catch (e) {}
                    if (count > 0) renderCitationBadge(badge, count);
                } else {
                    // Mark as a known miss so we don't hammer SS every page-load,
                    // but with a shorter TTL than hits so we can recover.
                    try { localStorage.setItem(cacheKey, JSON.stringify({ count: null, ts: Date.now() })); } catch (e) {}
                    console.warn('[citations] no count for', badge.dataset.title || cacheKey);
                }
            })
            .catch(function(err) {
                console.warn('[citations] fetch failed for', cacheKey, err);
            })
            .finally(function() { setTimeout(next, 400); });
    }

    next();
}

function renderCitationBadge(el, count) {
    el.innerHTML = '<i class="fas fa-quote-right"></i> ' + count;
    el.classList.add('has-count');
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
        });
    });
}
