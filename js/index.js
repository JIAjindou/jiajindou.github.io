$(document).ready(function() {
    setupPublicationFilters();
    setupVideoToggles();
});

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
        });
    });
}
