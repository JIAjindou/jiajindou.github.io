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
// Lookup priority: arXiv ID -> DOI -> title match (search/match endpoint).
function loadCitationCounts() {
    var badges = document.querySelectorAll('.citation-badge');
    var ONE_DAY = 24 * 60 * 60 * 1000;
    var queue = Array.prototype.slice.call(badges);

    function next() {
        var badge = queue.shift();
        if (!badge) return;

        var url, cacheKey;
        if (badge.dataset.arxiv) {
            url = 'https://api.semanticscholar.org/graph/v1/paper/arXiv:' + encodeURIComponent(badge.dataset.arxiv) + '?fields=citationCount';
            cacheKey = 'citation_arXiv:' + badge.dataset.arxiv;
        } else if (badge.dataset.doi) {
            url = 'https://api.semanticscholar.org/graph/v1/paper/DOI:' + encodeURIComponent(badge.dataset.doi) + '?fields=citationCount';
            cacheKey = 'citation_DOI:' + badge.dataset.doi;
        } else if (badge.dataset.title) {
            url = 'https://api.semanticscholar.org/graph/v1/paper/search/match?fields=citationCount&query=' + encodeURIComponent(badge.dataset.title);
            cacheKey = 'citation_title:' + badge.dataset.title;
        } else {
            setTimeout(next, 0);
            return;
        }

        var cached = null;
        try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) {}
        if (cached && (Date.now() - cached.ts) < ONE_DAY) {
            renderCitationBadge(badge, cached.count);
            setTimeout(next, 0);
            return;
        }

        fetch(url)
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                if (!data) return;
                // search/match returns { data: [...] }; direct lookup returns the paper object.
                var count = (data.data && data.data[0] && data.data[0].citationCount)
                    || data.citationCount;
                if (typeof count === 'number') {
                    try { localStorage.setItem(cacheKey, JSON.stringify({ count: count, ts: Date.now() })); } catch (e) {}
                    renderCitationBadge(badge, count);
                }
            })
            .catch(function() {})
            .finally(function() { setTimeout(next, 400); });
    }

    next();
}

function renderCitationBadge(el, count) {
    el.innerHTML = '<i class="fas fa-quote-right"></i> ' + count;
    el.classList.add('has-count');
}
