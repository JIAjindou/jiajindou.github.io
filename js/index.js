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

// Fetch citation counts from OpenAlex and fill in .citation-badge
// elements. Cached in localStorage for 24h.
// Priority: explicit data-citations override -> DOI -> arXiv DOI -> title search.
function loadCitationCounts() {
    var badges = document.querySelectorAll('.citation-badge');
    var ONE_DAY = 24 * 60 * 60 * 1000;
    var POLITE = 'mailto=jindou.jia@ntu.edu.sg';
    var queue = Array.prototype.slice.call(badges);

    function next() {
        var badge = queue.shift();
        if (!badge) return;

        // Manual override wins immediately.
        if (badge.dataset.citations) {
            renderCitationBadge(badge, parseInt(badge.dataset.citations, 10));
            setTimeout(next, 0);
            return;
        }

        var url, cacheKey;
        if (badge.dataset.doi) {
            url = 'https://api.openalex.org/works/doi:' + encodeURIComponent(badge.dataset.doi) + '?select=cited_by_count&' + POLITE;
            cacheKey = 'oa_doi:' + badge.dataset.doi;
        } else if (badge.dataset.arxiv) {
            // arXiv assigns DOIs of the form 10.48550/arXiv.<id> for recent papers.
            url = 'https://api.openalex.org/works/doi:10.48550/arXiv.' + encodeURIComponent(badge.dataset.arxiv) + '?select=cited_by_count&' + POLITE;
            cacheKey = 'oa_arxiv:' + badge.dataset.arxiv;
        } else if (badge.dataset.title) {
            url = 'https://api.openalex.org/works?search=' + encodeURIComponent(badge.dataset.title) + '&per-page=1&select=cited_by_count&' + POLITE;
            cacheKey = 'oa_title:' + badge.dataset.title;
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
            .then(function(r) {
                // 404 on arXiv-DOI? Fall back to title search.
                if (r.status === 404 && badge.dataset.arxiv && badge.dataset.title) {
                    return fetch('https://api.openalex.org/works?search=' + encodeURIComponent(badge.dataset.title) + '&per-page=1&select=cited_by_count&' + POLITE)
                        .then(function(r2) { return r2.ok ? r2.json() : null; });
                }
                return r.ok ? r.json() : null;
            })
            .then(function(data) {
                if (!data) return;
                // Search results look like { results: [...] }; direct lookup returns the work.
                var count = (data.results && data.results[0] && data.results[0].cited_by_count);
                if (typeof count !== 'number') count = data.cited_by_count;
                if (typeof count === 'number') {
                    try { localStorage.setItem(cacheKey, JSON.stringify({ count: count, ts: Date.now() })); } catch (e) {}
                    renderCitationBadge(badge, count);
                }
            })
            .catch(function() {})
            .finally(function() { setTimeout(next, 200); });
    }

    next();
}

function renderCitationBadge(el, count) {
    el.innerHTML = '<i class="fas fa-quote-right"></i> ' + count;
    el.classList.add('has-count');
}
