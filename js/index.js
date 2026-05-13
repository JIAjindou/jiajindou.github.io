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

});
