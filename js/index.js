$(document).ready(function() {
    loadCitationCounts();

    // Hover-to-play preview videos. Videos use preload="none" and
    // load the actual file from data-src only on first hover.
    $('.publication-mousecell').mouseover(function() {
        var $cell = $(this);
        var $video = $cell.find('video');
        if (!$video.length) return;
        var v = $video[0];
        var $img = $cell.find('img');

        var swapToVideo = function() {
            $video.css('display', 'inline-block');
            $img.css('display', 'none');
            var p = v.play();
            if (p && typeof p.catch === 'function') p.catch(function() {});
        };

        // First-time setup: kick off the load and warm cache for the
        // optional second clip so the src1 -> src2 swap on `ended` feels
        // seamless.
        if (v.dataset.src && !v.src) {
            v.src = v.dataset.src;
            v.dataset.playingSecond = '0';
            if (v.dataset.src2) {
                fetch(v.dataset.src2).catch(function() {});
            }
        }

        // Keep the still image visible until the video has at least one
        // frame buffered, so the user never sees a white loading flash
        // on first hover. readyState >= 2 means HAVE_CURRENT_DATA.
        if (v.readyState >= 2) {
            swapToVideo();
        } else {
            var onReady = function() {
                v.removeEventListener('loadeddata', onReady);
                // Only swap if the cursor is still over the cell — if the
                // user moved away during the load, leave the image up.
                if ($cell.is(':hover')) swapToVideo();
            };
            v.addEventListener('loadeddata', onReady);
        }
    });
    $('.publication-mousecell').mouseout(function() {
        var $video = $(this).find('video');
        if ($video.length) {
            $video[0].pause();
            $video.css('display', 'none');
            $(this).find('img').css('display', 'inline-block');
        }
    });

    // Chain two preview videos: when src1 ends, swap to src2; when src2
    // ends, swap back to src1 — gives an infinite loop across both clips.
    // Single-clip videos keep the native HTML5 `loop` attribute (no `ended`).
    $('.publication-mousecell video').on('ended', function() {
        var src2 = this.dataset.src2;
        if (!src2) return;
        var playingSecond = this.dataset.playingSecond === '1';
        this.src = playingSecond ? this.dataset.src : src2;
        this.dataset.playingSecond = playingSecond ? '0' : '1';
        var p = this.play();
        if (p && typeof p.catch === 'function') p.catch(function() {});
    });

});

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

// Background-preload every hover-preview video so first hover plays
// instantly. We wait for `window.load` (all initial assets done) plus a
// small buffer so the critical resources (cover images, fonts, CSS)
// finish on the user's network before we start pulling the heavy mp4s.
$(window).on('load', function() {
    setTimeout(function() {
        $('.publication-mousecell video').each(function() {
            var v = this;
            if (v.dataset.src && !v.src) {
                v.preload = 'auto';
                v.src = v.dataset.src;
                v.dataset.playingSecond = '0';
                // Setting src on an element with preload=auto triggers the
                // browser's media loader, which fetches and decodes the
                // first frame even before any play() call.
            }
            // Warm the HTTP cache for the optional second clip (MARS).
            if (v.dataset.src2) {
                fetch(v.dataset.src2).catch(function() {});
            }
        });
    }, 500);
});
