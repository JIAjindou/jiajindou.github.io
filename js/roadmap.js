/*
 * Research roadmap: a particle stream that flows through the research stages
 * of _data/roadmap.yml (embedded as #roadmap-data), with each stage's robot
 * platforms hanging off the stream.
 *
 * Each stage moves the particles the way its research works:
 *   laminar     ordered parallel lanes                  (model-based control)
 *   feedback    a disturbance appears, feedback damps it (learning + control)
 *   uncertainty the lanes melt into a ±2σ envelope       (uncertainty prediction)
 *   generative  lanes -> noise -> a few sharp modes      (flow-matching policies)
 *   world       each mode branches into imagined futures (world models)
 *   next        the futures fade into the frontier
 *
 * Desktop: horizontal stream, stages as columns, an inspector panel that
 * auto-cycles through the stages (hover/tap to pick one). Narrow screens: a
 * vertical stream down the left edge with every stage's details inline.
 * Pauses off-screen; a still frame for prefers-reduced-motion.
 */
(function () {
    'use strict';

    var root = document.getElementById('roadmap');
    var dataEl = document.getElementById('roadmap-data');
    if (!root || !dataEl) return;
    var stages;
    try { stages = JSON.parse(dataEl.textContent); } catch (e) { return; }
    if (!stages || !stages.length) return;

    var zh = (document.documentElement.lang || '').slice(0, 2) === 'zh';
    var imgBase = root.getAttribute('data-img-base') || '/images/hardware/';
    var labelWorks = root.getAttribute('data-label-works') || 'Key works';
    var labelHint = root.getAttribute('data-label-hint') || '';
    var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var CYCLE_MS = 5200;

    function tr(o, k) { return (zh && o[k + '_zh']) || o[k] || ''; }
    function esc(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function hexRgb(h) {
        h = h.replace('#', '');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function smooth(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

    // ── Markup ──────────────────────────────────────────────────────────
    var wrap = root.querySelector('.rm-stages');
    var inspector = root.querySelector('.rm-inspector');
    var bg = document.createElement('canvas');
    var fx = document.createElement('canvas');
    bg.className = fx.className = 'rm-canvas';
    bg.setAttribute('aria-hidden', 'true');
    fx.setAttribute('aria-hidden', 'true');
    wrap.appendChild(bg);
    wrap.appendChild(fx);

    function worksHtml(st) {
        if (!st.works || !st.works.length) return '';
        return '<div class="rm-works">' + st.works.map(function (w) {
            return '<a class="rm-chip" href="#pub-' + esc(w.id) + '"><b>' + esc(w.venue) + '</b>' + esc(w.name) + '</a>';
        }).join('') + '</div>';
    }

    var n = stages.length;
    var nextIdx = -1, worldIdx = -1;
    var els = [], nodes = [];
    stages.forEach(function (st, i) {
        if (st.flow === 'next') nextIdx = i;
        if (st.flow !== 'next') worldIdx = i;      // last behaviour stage
        var el = document.createElement('div');
        el.className = 'rm-stage' + (st.flow === 'next' ? ' rm-next' : '');
        el.style.setProperty('--c', st.color);
        el.setAttribute('tabindex', '0');
        var robots = (st.platforms || []).map(function (p) {
            return '<span class="rm-robot"><img src="' + esc(imgBase + p) + '" alt="" loading="lazy" decoding="async"></span>';
        }).join('');
        el.innerHTML =
            '<div class="rm-head"><span class="rm-idx">' + esc(st.index || '') + '</span>' +
            '<span class="rm-title">' + esc(tr(st, 'title')) + '</span>' +
            '<span class="rm-years">' + esc(tr(st, 'years')) + '</span></div>' +
            '<div class="rm-gap"><div class="rm-caption">' + esc(tr(st, 'caption')) + '</div>' +
            '<div class="rm-flow"></div></div>' +
            '<div class="rm-robots">' + robots + '</div>' +
            '<div class="rm-detail"><p>' + esc(tr(st, 'desc')) + '</p>' + worksHtml(st) + '</div>';
        wrap.appendChild(el);
        els.push(el);
        var node = document.createElement('span');
        node.className = 'rm-node';
        node.style.setProperty('--c', st.color);
        wrap.appendChild(node);
        nodes.push(node);
    });
    if (nextIdx < 0) nextIdx = n;   // no frontier stage: fade at the very end

    // ── Geometry ────────────────────────────────────────────────────────
    var W = 0, H = 0, dpr = 1, vertical = false, k = 1, pathLen = 1;
    var LUTN = 720;
    var lx = new Float32Array(LUTN + 1), ly = new Float32Array(LUTN + 1);
    var lnx = new Float32Array(LUTN + 1), lny = new Float32Array(LUTN + 1);
    var sb = [];          // stage start positions along the stream, sb[n] = 1
    var nodeS = [];       // node position of each stage along the stream
    var colors = [];      // 64 colour strings along the stream
    var COLN = 64;

    function layout() {
        vertical = window.innerWidth < 769;
        k = vertical ? 0.42 : 1;
        W = wrap.clientWidth;
        H = wrap.clientHeight;
        if (!W || !H) return false;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        [bg, fx].forEach(function (c) {
            c.width = Math.round(W * dpr);
            c.height = Math.round(H * dpr);
            c.style.width = W + 'px';
            c.style.height = H + 'px';
        });

        var wr = wrap.getBoundingClientRect();
        var rc = els.map(function (el) {
            var r = el.getBoundingClientRect();
            return { l: r.left - wr.left, t: r.top - wr.top, w: r.width, h: r.height };
        });
        var last = rc[n - 1], a0, a1, cross, amp, freq;
        if (!vertical) {
            var g = els[0].querySelector('.rm-flow').getBoundingClientRect();
            cross = g.top - wr.top + g.height / 2;
            a0 = rc[0].l + 2;
            a1 = last.l + last.w;
            amp = 9; freq = 1.25;
        } else {
            cross = 27;
            a0 = rc[0].t + 4;
            a1 = last.t + last.h;
            amp = 2.5; freq = 2;
        }
        pathLen = a1 - a0;
        for (var j = 0; j <= LUTN; j++) {
            var s = j / LUTN;
            var m = a0 + s * pathLen;
            var c = cross + amp * Math.sin(2 * Math.PI * freq * s + 0.6);
            if (!vertical) { lx[j] = m; ly[j] = c; } else { lx[j] = c; ly[j] = m; }
        }
        for (j = 0; j <= LUTN; j++) {
            var j0 = Math.max(0, j - 1), j1 = Math.min(LUTN, j + 1);
            var tx = lx[j1] - lx[j0], ty = ly[j1] - ly[j0];
            var len = Math.sqrt(tx * tx + ty * ty) || 1;
            lnx[j] = -ty / len;
            lny[j] = tx / len;
        }

        sb = rc.map(function (r, i) {
            return i === 0 ? 0 : ((vertical ? r.t : r.l) - a0) / pathLen;
        });
        sb.push(1);
        nodeS = rc.map(function (r) {
            var m = vertical ? r.t + 12 : r.l + r.w / 2;
            return Math.max(0, Math.min(1, (m - a0) / pathLen));
        });
        nodes.forEach(function (nd, i) {
            var p = at(nodeS[i]);
            nd.style.left = p[0] + 'px';
            nd.style.top = p[1] + 'px';
        });

        // Colour ramp: each stage's colour at its node, blended in between.
        var rgb = stages.map(function (st) { return hexRgb(st.color || '#7c8cff'); });
        colors = [];
        for (var q = 0; q < COLN; q++) {
            var sq = q / (COLN - 1), a = 0;
            while (a < n - 1 && nodeS[a + 1] <= sq) a++;
            var b = Math.min(a + 1, n - 1);
            var f = (b === a || sq <= nodeS[a]) ? 0 : smooth((sq - nodeS[a]) / (nodeS[b] - nodeS[a]));
            colors.push('rgb(' + [0, 1, 2].map(function (z) {
                return Math.round(rgb[a][z] + (rgb[b][z] - rgb[a][z]) * f);
            }).join(',') + ')');
        }
        drawStatic(rc, wr);
        return true;
    }

    // Point on the stream at s (linear interpolation in the lookup table).
    function at(s) {
        var f = Math.max(0, Math.min(1, s)) * LUTN, j = f | 0, fr = f - j;
        if (j >= LUTN) { j = LUTN - 1; fr = 1; }
        return [lx[j] + (lx[j + 1] - lx[j]) * fr, ly[j] + (ly[j + 1] - ly[j]) * fr];
    }

    function stageAt(s) {
        var i = 0;
        while (i < n - 1 && s >= sb[i + 1]) i++;
        return i;
    }

    // ── Static layer: stream glow, uncertainty envelope, robot tethers ──
    function drawStatic(rc, wr) {
        var c = bg.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, W, H);
        var grad = vertical ? c.createLinearGradient(0, ly[0], 0, ly[LUTN])
                            : c.createLinearGradient(lx[0], 0, lx[LUTN], 0);
        stages.forEach(function (st, i) { grad.addColorStop(nodeS[i], st.color); });

        function strokePath(width, alpha) {
            c.beginPath();
            for (var j = 0; j <= LUTN; j += 4) {
                if (j === 0) c.moveTo(lx[j], ly[j]); else c.lineTo(lx[j], ly[j]);
            }
            c.strokeStyle = grad;
            c.globalAlpha = alpha;
            c.lineWidth = width;
            c.lineCap = 'round';
            c.stroke();
        }
        strokePath(46 * k, 0.035);
        strokePath(16 * k, 0.05);
        strokePath(1, 0.25);

        // Uncertainty stage: dashed ±2σ envelope around the stream.
        stages.forEach(function (st, i) {
            if (st.flow !== 'uncertainty') return;
            c.setLineDash([3, 4]);
            c.lineWidth = 1;
            c.globalAlpha = 0.5;
            c.strokeStyle = st.color;
            [-1, 1].forEach(function (sign) {
                c.beginPath();
                for (var q = 0; q <= 60; q++) {
                    var s = sb[i] + (sb[i + 1] - sb[i]) * q / 60;
                    var t = q / 60, b = Math.pow(Math.sin(Math.PI * t), 2);
                    var e = sign * (16.5 * k * (1 - b) + 27 * k * b + 3 * k);
                    var j = Math.round(s * LUTN), p = at(s);
                    var x = p[0] + lnx[j] * e, y = p[1] + lny[j] * e;
                    if (q === 0) c.moveTo(x, y); else c.lineTo(x, y);
                }
                c.stroke();
            });
            c.setLineDash([]);
        });

        // Tethers from the stream down to each robot (horizontal layout).
        if (!vertical) {
            els.forEach(function (el, i) {
                var col = stages[i].color;
                el.querySelectorAll('.rm-robot').forEach(function (rb) {
                    var r = rb.getBoundingClientRect();
                    var x = r.left - wr.left + r.width / 2, yEnd = r.top - wr.top + 6;
                    var s = (x - lx[0]) / (lx[LUTN] - lx[0]);
                    var yStart = at(s)[1] + 34;
                    if (yEnd - yStart < 8) return;
                    var g2 = c.createLinearGradient(0, yStart, 0, yEnd);
                    g2.addColorStop(0, col);
                    g2.addColorStop(1, 'rgba(255,255,255,0)');
                    c.globalAlpha = 0.5;
                    c.strokeStyle = g2;
                    c.lineWidth = 1;
                    c.setLineDash([1, 3]);
                    c.beginPath();
                    c.moveTo(x, yStart);
                    c.lineTo(x, yEnd);
                    c.stroke();
                    c.setLineDash([]);
                    c.globalAlpha = 0.9;
                    c.fillStyle = col;
                    c.beginPath();
                    c.arc(x, yStart, 1.6, 0, Math.PI * 2);
                    c.fill();
                });
            });
        }
        c.globalAlpha = 1;
    }

    // ── Particles ───────────────────────────────────────────────────────
    var N = 0, ps, lane, uu, nn, mode, br, sz, spd, bright;
    var MODE = [-1, 0, 1];

    function gauss() {
        var u = 0;
        while (!u) u = Math.random();
        var g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
        return g > 2.4 ? 2.4 : g < -2.4 ? -2.4 : g;
    }
    function respawn(i, s) {
        ps[i] = s;
        lane[i] = Math.max(-3, Math.min(3, Math.round(gauss() * 1.25)));
        uu[i] = gauss();
        nn[i] = gauss();
        var r = Math.random();
        mode[i] = r < 0.34 ? 0 : r < 0.66 ? 1 : 2;
        br[i] = (Math.floor(Math.random() * 3) - 1) * 0.7 + gauss() * 0.05;
        sz[i] = 0.9 + Math.random() * 1.1;
        spd[i] = 0.8 + Math.random() * 0.4;
        bright[i] = 0.55 + Math.random() * 0.45;
    }
    function initParticles() {
        N = vertical ? 700 : Math.round(Math.min(1900, W * 2));
        ps = new Float32Array(N); lane = new Float32Array(N); uu = new Float32Array(N);
        nn = new Float32Array(N); mode = new Uint8Array(N); br = new Float32Array(N);
        sz = new Float32Array(N); spd = new Float32Array(N); bright = new Float32Array(N);
        for (var i = 0; i < N; i++) respawn(i, Math.random());
    }

    // Lateral offset (px) of particle i at stream position s.
    function offset(i, s, time) {
        var bi = Math.min(stageAt(s), worldIdx);
        var end = bi === worldIdx ? 1 : sb[bi + 1];
        var t = (s - sb[bi]) / (end - sb[bi]);
        var L = lane[i] * 5.5 * k;
        switch (stages[bi].flow) {
            case 'feedback':
                var env = Math.exp(-2.6 * t) * (1 - t) * (1 - Math.exp(-14 * t));
                return L + 17 * k * env * Math.sin(2 * Math.PI * 2.4 * t - time * 1.6);
            case 'uncertainty':
                var b = Math.sin(Math.PI * t);
                b *= b;
                return L * (1 - b) + uu[i] * 13 * k * b;
            case 'generative':
                if (t < 0.3) {
                    var w = smooth(t / 0.3);
                    return L * (1 - w) + nn[i] * 22 * k * w;
                }
                var w2 = smooth((t - 0.3) / 0.7);
                return nn[i] * 22 * k * (1 - w2) + (MODE[mode[i]] * 20 + uu[i] * 1.6) * k * w2;
            case 'world':
                return (MODE[mode[i]] * 20 + uu[i] * 1.6) * k + 30 * k * br[i] * Math.pow(t, 1.3);
            default:   // laminar
                return L;
        }
    }

    var ctx = fx.getContext('2d');
    var buckets = [];
    var LEVELS = [0.22, 0.42, 0.66, 0.92];
    for (var q = 0; q < COLN * LEVELS.length; q++) buckets.push([]);
    var active = -1;

    function render(time, trails) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (trails) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.globalAlpha = 1;
            ctx.fillStyle = 'rgba(0,0,0,' + trails + ')';
            ctx.fillRect(0, 0, W, H);
        } else {
            ctx.clearRect(0, 0, W, H);
        }
        ctx.globalCompositeOperation = 'source-over';
        var dim = active >= 0 && !vertical;
        var fadeFrom = nextIdx < n ? sb[nextIdx] : 0.97;
        for (var b = 0; b < buckets.length; b++) buckets[b].length = 0;
        for (var i = 0; i < N; i++) {
            var s = ps[i];
            var a = bright[i];
            if (s < 0.025) a *= s / 0.025;
            if (s > fadeFrom) a *= 1 - smooth(((s - fadeFrom) / (1 - fadeFrom) - 0.15) / 0.85);
            if (dim && stageAt(s) !== active) a *= 0.38;
            if (a < 0.06) continue;
            var f = s * LUTN, j = f | 0, fr = f - j;
            if (j >= LUTN) { j = LUTN - 1; fr = 1; }
            var o = offset(i, s, time);
            var x = lx[j] + (lx[j + 1] - lx[j]) * fr + lnx[j] * o;
            var y = ly[j] + (ly[j + 1] - ly[j]) * fr + lny[j] * o;
            var lv = a < 0.3 ? 0 : a < 0.55 ? 1 : a < 0.8 ? 2 : 3;
            var bk = buckets[lv * COLN + Math.min(COLN - 1, (s * COLN) | 0)];
            bk.push(x, y, sz[i]);
        }
        for (b = 0; b < buckets.length; b++) {
            var arr = buckets[b];
            if (!arr.length) continue;
            ctx.globalAlpha = LEVELS[(b / COLN) | 0];
            ctx.fillStyle = colors[b % COLN];
            ctx.beginPath();
            for (var p = 0; p < arr.length; p += 3) {
                var d = arr[p + 2];
                ctx.rect(arr[p] - d / 2, arr[p + 1] - d / 2, d, d);
            }
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    function step(dt) {
        var v = (vertical ? 40 : 48) / pathLen;   // px per second along the stream
        for (var i = 0; i < N; i++) {
            ps[i] += v * spd[i] * dt;
            if (ps[i] >= 1) respawn(i, Math.random() * 0.01);
        }
    }

    // ── Animation loop ──────────────────────────────────────────────────
    var running = false, onScreen = false, raf = 0, lastT = 0, clock = 0, ready = false;
    function frame(now) {
        if (!running) return;
        var dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
        lastT = now;
        clock += dt;
        step(dt);
        render(clock, 1 - Math.pow(1 - 0.2, dt * 60));
        raf = requestAnimationFrame(frame);
    }
    function start() {
        if (running || !ready || reduceMotion || !onScreen || document.hidden) return;
        running = true;
        lastT = performance.now();
        raf = requestAnimationFrame(frame);
    }
    function stop() {
        running = false;
        cancelAnimationFrame(raf);
    }

    // ── Active stage, inspector, auto-cycle ─────────────────────────────
    var cycleTimer = 0, hovering = false, resumeTimer = 0;

    function renderInspector(i) {
        var st = stages[i];
        inspector.style.setProperty('--c', st.color);
        var works = st.works && st.works.length
            ? '<div class="rm-works-label">' + esc(labelWorks) + '</div>' + worksHtml(st) : '';
        inspector.innerHTML =
            '<div class="rm-insp-head rm-in"><span class="rm-idx">' + esc(st.index || '') + '</span>' +
            '<span class="rm-insp-title">' + esc(tr(st, 'title')) + '</span>' +
            '<span class="rm-years">' + esc(tr(st, 'years')) + '</span></div>' +
            '<div class="rm-insp-body rm-in"><p>' + esc(tr(st, 'desc')) + '</p>' + works + '</div>' +
            (labelHint ? '<div class="rm-hint">' + esc(labelHint) + '</div>' : '');
    }

    function setActive(i) {
        if (i === active) return;
        active = i;
        root.classList.toggle('has-active', i >= 0);
        els.forEach(function (el, j) { el.classList.toggle('is-active', j === i); });
        nodes.forEach(function (nd, j) { nd.classList.toggle('is-active', j === i); });
        if (i >= 0 && !vertical) renderInspector(i);
        if (reduceMotion && ready) render(clock, 0);
    }

    function cycling() { return !vertical && !reduceMotion && !hovering && onScreen; }
    function scheduleCycle() {
        clearTimeout(cycleTimer);
        if (!cycling()) return;
        cycleTimer = setTimeout(function () {
            setActive((active + 1) % n);
            scheduleCycle();
        }, CYCLE_MS);
    }

    els.forEach(function (el, i) {
        el.addEventListener('mouseenter', function () { if (!vertical) { setActive(i); } });
        el.addEventListener('focus', function () { if (!vertical) setActive(i); });
        el.addEventListener('click', function () {
            if (vertical) return;
            setActive(i);
            hovering = true;             // a tap pauses the tour for a while
            scheduleCycle();
            clearTimeout(resumeTimer);
            resumeTimer = setTimeout(function () { hovering = false; scheduleCycle(); }, 9000);
        });
    });
    root.addEventListener('mouseenter', function () {
        hovering = true;
        clearTimeout(resumeTimer);
        scheduleCycle();
    });
    root.addEventListener('mouseleave', function () {
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(function () { hovering = false; scheduleCycle(); }, 1500);
    });

    // Narrow screens: the stage nearest the middle of the viewport is active.
    function trackScroll() {
        if (!vertical || !onScreen) return;
        var mid = window.innerHeight * 0.5, best = -1, bestD = 1e9;
        els.forEach(function (el, i) {
            var r = el.getBoundingClientRect();
            var d = Math.abs(r.top + Math.min(r.height, 160) / 2 - mid);
            if (d < bestD) { bestD = d; best = i; }
        });
        setActive(best);
    }
    var scrollQueued = false;
    window.addEventListener('scroll', function () {
        if (scrollQueued) return;
        scrollQueued = true;
        requestAnimationFrame(function () { scrollQueued = false; trackScroll(); });
    }, { passive: true });

    // ── Boot / resize / visibility ──────────────────────────────────────
    function relayout() {
        var wasVertical = vertical;
        if (!layout()) return;
        var modeChanged = !ready || wasVertical !== vertical;
        if (modeChanged) initParticles();
        ready = true;
        if (!vertical) {
            if (active < 0) setActive(0);
            else if (modeChanged) renderInspector(active);
        }
        if (vertical) trackScroll();
        if (reduceMotion) {
            for (var i = 0; i < 6; i++) step(0.3);
            render(clock, 0);
        }
        scheduleCycle();
        start();
    }

    var resizeTimer = 0;
    function queueRelayout() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(relayout, 120);
    }
    if (window.ResizeObserver) new ResizeObserver(queueRelayout).observe(wrap);
    else window.addEventListener('resize', queueRelayout);
    // Robot images arrive late; their size can shift the layout.
    root.querySelectorAll('.rm-robot img').forEach(function (img) {
        if (!img.complete) img.addEventListener('load', queueRelayout);
    });

    if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
            onScreen = entries[0].isIntersecting;
            if (onScreen) { start(); scheduleCycle(); trackScroll(); } else { stop(); scheduleCycle(); }
        }, { rootMargin: '80px' }).observe(root);
    } else {
        onScreen = true;
    }
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(); else start();
    });

    relayout();
})();
