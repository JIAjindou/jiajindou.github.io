$(document).ready(function() {
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
