$(document).ready(function() {
    // Hover-to-play preview videos. Videos use preload="none" and
    // load the actual file from data-src only on first hover.
    $('.publication-mousecell').mouseover(function() {
        var $video = $(this).find('video');
        if ($video.length) {
            var v = $video[0];
            if (v.dataset.src && !v.src) {
                v.src = v.dataset.src;
                v.dataset.playingSecond = '0';
                // Warm browser cache for the optional second clip so the
                // src1 -> src2 swap on `ended` feels seamless.
                if (v.dataset.src2) {
                    fetch(v.dataset.src2).catch(function() {});
                }
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
