$(document).ready(function() {
    // Hover-to-play preview videos. Videos use preload="none" and
    // load the actual file from data-src only on first hover.
    $('.publication-mousecell').mouseover(function() {
        var $video = $(this).find('video');
        if ($video.length) {
            var v = $video[0];
            if (v.dataset.src && !v.src) {
                v.src = v.dataset.src;
            }
            $video.css('display', 'inline-block');
            $(this).find('img').css('display', 'none');
            var p = v.play();
            if (p && typeof p.catch === 'function') p.catch(function() {});
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

    loadCitationCounts();
});

// Fetch citation counts from Semantic Scholar Graph API and fill in
// .citation-badge elements. Cached in localStorage for 24h.
function loadCitationCounts() {
    var badges = document.querySelectorAll('.citation-badge[data-arxiv], .citation-badge[data-doi]');
    var ONE_DAY = 24 * 60 * 60 * 1000;
    var queue = Array.prototype.slice.call(badges);

    function next() {
        var badge = queue.shift();
        if (!badge) return;
        var key = badge.dataset.arxiv
            ? 'arXiv:' + badge.dataset.arxiv
            : 'DOI:' + badge.dataset.doi;
        var cacheKey = 'citation_' + key;

        var cached = null;
        try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) {}
        if (cached && (Date.now() - cached.ts) < ONE_DAY) {
            renderCitationBadge(badge, cached.count);
            setTimeout(next, 0);
            return;
        }

        fetch('https://api.semanticscholar.org/graph/v1/paper/' + encodeURIComponent(key) + '?fields=citationCount')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                if (data && typeof data.citationCount === 'number') {
                    try { localStorage.setItem(cacheKey, JSON.stringify({ count: data.citationCount, ts: Date.now() })); } catch (e) {}
                    renderCitationBadge(badge, data.citationCount);
                }
            })
            .catch(function() {})
            .finally(function() { setTimeout(next, 300); });
    }

    next();
}

function renderCitationBadge(el, count) {
    el.innerHTML = '<i class="fas fa-quote-right"></i> ' + count;
    el.classList.add('has-count');
}
