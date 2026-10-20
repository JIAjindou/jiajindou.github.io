/*
 * Research roadmap: the research directions in _data/roadmap.yml (embedded as
 * #roadmap-data) drawn as circuit-like tracks across the stages, with
 * particles flowing along them. The particles only show direction: side tracks
 * branch off the trunk and merge back at the end, and loops run back along a
 * track (feedback). Each stage's robots hang below the tracks.
 *
 * Desktop: stages as columns plus an inspector that tours them (hover/tap to
 * pick one). Narrow screens: the tracks run down the left edge and every
 * stage's details are inline. Pauses off-screen; still for reduced motion.
 */
(function () {
    'use strict';

    var root = document.getElementById('roadmap');
    var dataEl = document.getElementById('roadmap-data');
    if (!root || !dataEl) return;
    var data;
    try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
    var stages = data && data.stages, tracks = (data && data.tracks) || [], loops = (data && data.loops) || [];
    if (!stages || !stages.length || !tracks.length) return;

    var zh = (document.documentElement.lang || '').slice(0, 2) === 'zh';
    var imgBase = root.getAttribute('data-img-base') || '/images/hardware/';
    var labelWorks = root.getAttribute('data-label-works') || 'Key works';
    var labelHint = root.getAttribute('data-label-hint') || '';
    var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var CYCLE_MS = 5200;

    var trackByKey = {};
    tracks.forEach(function (t) { trackByKey[t.key] = t; });
    var trunk = tracks.filter(function (t) { return !t.side; })[0] || tracks[0];
    function trackOf(st) { return trackByKey[st.track] || trunk; }

    function tr(o, k) { return (zh && o[k + '_zh']) || o[k] || ''; }
    function esc(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

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

    // Legend of the directions (shown on narrow screens, where the tracks
    // are too close together to label inline).
    var legend = document.createElement('div');
    legend.className = 'rm-legend';
    legend.innerHTML = tracks.map(function (t) {
        return '<span style="--c:' + esc(t.color) + '"><i></i>' + esc(tr(t, 'name')) + '</span>';
    }).join('');
    root.insertBefore(legend, wrap);

    function worksHtml(st) {
        if (!st.works || !st.works.length) return '';
        return '<div class="rm-works">' + st.works.map(function (w) {
            return '<a class="rm-chip" href="#pub-' + esc(w.id) + '"><b>' + esc(w.venue) + '</b>' + esc(w.name) + '</a>';
        }).join('') + '</div>';
    }

    var n = stages.length, last = n - 1;
    var els = [], nodes = [];
    stages.forEach(function (st) {
        var color = trackOf(st).color;
        var el = document.createElement('div');
        el.className = 'rm-stage' + (st.key === 'next' ? ' rm-next' : '');
        el.style.setProperty('--c', color);
        el.setAttribute('tabindex', '0');
        var robots = (st.platforms || []).map(function (p) {
            return '<span class="rm-robot"><img src="' + esc(imgBase + p) + '" alt="" loading="lazy" decoding="async"></span>';
        }).join('');
        el.innerHTML =
            '<div class="rm-head"><span class="rm-idx">' + esc(st.index || '') + '</span>' +
            '<span class="rm-title">' + esc(tr(st, 'title')) + '</span>' +
            '<span class="rm-years">' + esc(tr(st, 'years')) + '</span></div>' +
            '<div class="rm-flow"></div>' +
            '<div class="rm-robots">' + robots + '</div>' +
            '<div class="rm-detail"><p>' + esc(tr(st, 'desc')) + '</p>' + worksHtml(st) + '</div>';
        wrap.appendChild(el);
        els.push(el);
        var node = document.createElement('span');
        node.className = 'rm-node';
        node.style.setProperty('--c', color);
        wrap.appendChild(node);
        nodes.push(node);
    });

    var labels = tracks.map(function (t) {
        var lb = document.createElement('span');
        lb.className = 'rm-track-label';
        lb.style.setProperty('--c', t.color);
        lb.textContent = tr(t, 'name');
        wrap.appendChild(lb);
        return lb;
    });

    // ── Geometry ────────────────────────────────────────────────────────
    // Routes are laid out in (m, c): m runs along the stages, c across them
    // (0 = trunk). toXY maps them to the screen for either orientation.
    var D = 34, LOOP = 28, CORNER = 10;
    var W = 0, H = 0, dpr = 1, vertical = false, k = 1, cross = 0, rail = 27;
    var col = [], routes = [];

    function toXY(m, c) { return vertical ? [rail + c * k, m] : [m, cross + c]; }

    function sampleRoute(rt) {
        var P = rt.pts.map(function (p) { return toXY(p[0], p[1]); });
        var poly = [P[0]];
        for (var i = 1; i < P.length - 1; i++) {
            var a = P[i - 1], b = P[i], c = P[i + 1];
            var l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
            var r = Math.min(CORNER, l1 / 2, l2 / 2);
            var p1 = [b[0] + (a[0] - b[0]) * r / l1, b[1] + (a[1] - b[1]) * r / l1];
            var p2 = [b[0] + (c[0] - b[0]) * r / l2, b[1] + (c[1] - b[1]) * r / l2];
            poly.push(p1);
            for (var q = 1; q <= 8; q++) {       // rounded corner (quadratic Bézier)
                var t = q / 8, u = 1 - t;
                poly.push([u * u * p1[0] + 2 * u * t * b[0] + t * t * p2[0],
                           u * u * p1[1] + 2 * u * t * b[1] + t * t * p2[1]]);
            }
        }
        poly.push(P[P.length - 1]);
        // Resample at a fixed step so particles move at constant speed.
        var STEP = 1.5, xs = [poly[0][0]], ys = [poly[0][1]], carry = 0;
        for (i = 1; i < poly.length; i++) {
            var x0 = poly[i - 1][0], y0 = poly[i - 1][1], dx = poly[i][0] - x0, dy = poly[i][1] - y0;
            var seg = Math.hypot(dx, dy), pos = STEP - carry;
            while (pos <= seg) {
                xs.push(x0 + dx * pos / seg);
                ys.push(y0 + dy * pos / seg);
                pos += STEP;
            }
            carry = seg - (pos - STEP);
        }
        var m = xs.length;
        rt.x = new Float32Array(xs); rt.y = new Float32Array(ys);
        rt.nx = new Float32Array(m); rt.ny = new Float32Array(m);
        for (i = 0; i < m; i++) {
            var j0 = Math.max(0, i - 2), j1 = Math.min(m - 1, i + 2);
            var tx = rt.x[j1] - rt.x[j0], ty = rt.y[j1] - rt.y[j0], len = Math.hypot(tx, ty) || 1;
            rt.nx[i] = -ty / len;
            rt.ny[i] = tx / len;
        }
        rt.step = STEP;
        rt.len = (m - 1) * STEP;
    }

    function buildRoutes() {
        routes = [];
        var mEnd = col[last].r - 4, mMerge = col[last].c;
        tracks.forEach(function (t) {
            var off = (t.side || 0) * D, pts;
            if (!t.side) {
                pts = [[col[0].l + 4, 0], [mEnd, 0]];
            } else {
                var b = col[Math.min(t.from || 1, last)].l;
                pts = [[b - 16, 0], [b + 18, off], [mMerge - 46, off], [mMerge - 12, 0]];
            }
            routes.push({ track: t, pts: pts, trunk: !t.side, off: off });
        });
        loops.forEach(function (lp) {
            var t = trackByKey[lp.track];
            if (!t || !col[lp.from] || !col[lp.to]) return;
            var off = (t.side || 0) * D, top = off + (off <= 0 ? -LOOP : LOOP);
            var a = col[lp.from].c, b = col[lp.to].c;
            routes.push({ track: t, loop: true, off: off,
                          pts: [[a + 14, off], [a - 14, top], [b + 14, top], [b - 14, off]] });
        });
        routes.forEach(sampleRoute);
    }

    // Offset of the lowest track at m (robots hang from it).
    function lowestAt(m) {
        var c = 0;
        routes.forEach(function (rt) {
            if (rt.loop || rt.trunk) return;
            if (m >= rt.pts[1][0] && m <= rt.pts[2][0]) c = Math.max(c, rt.off);
        });
        return c;
    }

    function layout() {
        vertical = window.innerWidth < 769;
        k = vertical ? 0.36 : 1;
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
        col = els.map(function (el) {
            var r = el.getBoundingClientRect();
            return vertical
                ? { l: r.top - wr.top, r: r.bottom - wr.top, c: r.top - wr.top + 12 }
                : { l: r.left - wr.left, r: r.right - wr.left, c: r.left - wr.left + r.width / 2 };
        });
        if (!vertical) {
            var f = els[0].querySelector('.rm-flow').getBoundingClientRect();
            cross = f.top - wr.top + f.height * 0.6;
        }
        buildRoutes();

        nodes.forEach(function (nd, i) {
            var t = trackOf(stages[i]);
            var p = toXY(col[i].c, i === last ? 0 : (t.side || 0) * D);
            nd.style.left = p[0] + 'px';
            nd.style.top = p[1] + 'px';
        });
        // Each direction's name sits just after its first node, in the space
        // between its line and the trunk (the trunk's goes below it).
        labels.forEach(function (lb, i) {
            var t = tracks[i], start = t.side ? col[Math.min(t.from || 1, last)] : col[0];
            var off = (t.side || 0) * D;
            var p = toXY(start.c + 16, t.side > 0 ? off - 17 : off + 17);
            lb.style.left = p[0] + 'px';
            lb.style.top = p[1] + 'px';
        });
        drawStatic(wr);
        return true;
    }

    // ── Static layer: tracks, junctions, loop arrows, robot tethers ─────
    function drawStatic(wr) {
        var c = bg.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, W, H);
        c.lineCap = 'round';
        c.lineJoin = 'round';

        function trace(rt) {
            c.beginPath();
            for (var i = 0; i < rt.x.length; i += 2) {
                if (i === 0) c.moveTo(rt.x[i], rt.y[i]); else c.lineTo(rt.x[i], rt.y[i]);
            }
            c.lineTo(rt.x[rt.x.length - 1], rt.y[rt.y.length - 1]);
        }
        routes.forEach(function (rt) {
            c.strokeStyle = rt.track.color;
            trace(rt);
            c.globalAlpha = 0.07;
            c.lineWidth = vertical ? 6 : 9;
            c.stroke();
            c.globalAlpha = rt.loop ? 0.45 : 0.55;
            c.lineWidth = 1.3;
            if (rt.loop) c.setLineDash([3, 4]);
            c.stroke();
            c.setLineDash([]);
        });

        // Chevrons along loops, pointing the way the loop runs.
        routes.forEach(function (rt) {
            if (!rt.loop) return;
            c.strokeStyle = rt.track.color;
            c.globalAlpha = 0.8;
            c.lineWidth = 1.3;
            var every = Math.round((vertical ? 60 : 80) / rt.step);
            for (var i = Math.round(every * 0.6); i < rt.x.length - every * 0.4; i += every) {
                var tx = rt.ny[i], ty = -rt.nx[i], s = vertical ? 3 : 4;  // unit tangent (direction of travel)
                c.beginPath();
                c.moveTo(rt.x[i] - tx * s + rt.nx[i] * s, rt.y[i] - ty * s + rt.ny[i] * s);
                c.lineTo(rt.x[i], rt.y[i]);
                c.lineTo(rt.x[i] - tx * s - rt.nx[i] * s, rt.y[i] - ty * s - rt.ny[i] * s);
                c.stroke();
            }
        });

        // Junctions where tracks split from / merge into the trunk.
        routes.forEach(function (rt) {
            if (rt.trunk) return;
            [0, rt.x.length - 1].forEach(function (i) {
                c.globalAlpha = 1;
                c.fillStyle = '#fff';
                c.strokeStyle = rt.track.color;
                c.lineWidth = 1.3;
                c.beginPath();
                c.arc(rt.x[i], rt.y[i], vertical ? 2 : 2.8, 0, Math.PI * 2);
                c.fill();
                c.stroke();
            });
        });

        // Tethers from the lowest track down to each robot (horizontal).
        if (!vertical) {
            els.forEach(function (el, i) {
                var color = trackOf(stages[i]).color;
                el.querySelectorAll('.rm-robot').forEach(function (rb) {
                    var r = rb.getBoundingClientRect();
                    var x = r.left - wr.left + r.width / 2, yEnd = r.top - wr.top + 6;
                    var low = lowestAt(x);
                    var yStart = cross + low + (low ? 9 : 28);   // clear the trunk's label
                    if (yEnd - yStart < 8) return;
                    var g = c.createLinearGradient(0, yStart, 0, yEnd);
                    g.addColorStop(0, color);
                    g.addColorStop(1, 'rgba(255,255,255,0)');
                    c.globalAlpha = 0.5;
                    c.strokeStyle = g;
                    c.lineWidth = 1;
                    c.setLineDash([1, 3]);
                    c.beginPath();
                    c.moveTo(x, yStart);
                    c.lineTo(x, yEnd);
                    c.stroke();
                    c.setLineDash([]);
                    c.globalAlpha = 0.9;
                    c.fillStyle = color;
                    c.beginPath();
                    c.arc(x, yStart, 1.6, 0, Math.PI * 2);
                    c.fill();
                });
            });
        }
        c.globalAlpha = 1;
    }

    // ── Particles (direction only) ──────────────────────────────────────
    var N = 0, pr, pd, pj, pv, ps, pb;
    function gauss() {
        var u = 0;
        while (!u) u = Math.random();
        var g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
        return g > 2.2 ? 2.2 : g < -2.2 ? -2.2 : g;
    }
    function initParticles() {
        var dens = vertical ? 0.3 : 0.5, counts = routes.map(function (rt) {
            return Math.round(rt.len * dens * (rt.loop ? 0.55 : 1));
        });
        N = counts.reduce(function (a, b) { return a + b; }, 0);
        pr = new Uint8Array(N); pd = new Float32Array(N); pj = new Float32Array(N);
        pv = new Float32Array(N); ps = new Float32Array(N); pb = new Float32Array(N);
        var i = 0;
        counts.forEach(function (cnt, r) {
            for (var q = 0; q < cnt; q++, i++) {
                pr[i] = r;
                pd[i] = Math.random() * routes[r].len;
                pj[i] = gauss() * (vertical ? 0.9 : 1.6);
                pv[i] = 0.85 + Math.random() * 0.3;
                ps[i] = 0.9 + Math.random() * 1.0;
                pb[i] = 0.5 + Math.random() * 0.5;
            }
        });
    }

    var ctx = fx.getContext('2d');
    var LEVELS = [0.22, 0.42, 0.66, 0.92];
    var buckets = [];
    var active = -1;

    function colAt(x, y) {
        var m = vertical ? y : x, i = 0;
        while (i < last && m >= col[i + 1].l) i++;
        return i;
    }

    function render(trails) {
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
        var nb = routes.length * LEVELS.length;
        while (buckets.length < nb) buckets.push([]);
        for (var b = 0; b < nb; b++) buckets[b].length = 0;
        var dim = active >= 0 && !vertical;
        for (var i = 0; i < N; i++) {
            var rt = routes[pr[i]], d = pd[i], a = pb[i];
            var fadeIn = rt.trunk ? 24 : 10, fadeOut = rt.trunk ? 60 : 14;
            if (d < fadeIn) a *= d / fadeIn;
            if (rt.len - d < fadeOut) a *= (rt.len - d) / fadeOut;
            var j = Math.min(rt.x.length - 1, (d / rt.step) | 0);
            var x = rt.x[j] + rt.nx[j] * pj[i], y = rt.y[j] + rt.ny[j] * pj[i];
            if (dim && colAt(x, y) !== active) a *= 0.4;
            if (a < 0.06) continue;
            var lv = a < 0.3 ? 0 : a < 0.55 ? 1 : a < 0.8 ? 2 : 3;
            buckets[pr[i] * LEVELS.length + lv].push(x, y, ps[i]);
        }
        for (b = 0; b < nb; b++) {
            var arr = buckets[b];
            if (!arr.length) continue;
            ctx.globalAlpha = LEVELS[b % LEVELS.length];
            ctx.fillStyle = routes[(b / LEVELS.length) | 0].track.color;
            ctx.beginPath();
            for (var p = 0; p < arr.length; p += 3) {
                var s = arr[p + 2];
                ctx.rect(arr[p] - s / 2, arr[p + 1] - s / 2, s, s);
            }
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function step(dt) {
        var v = vertical ? 34 : 44;   // px per second
        for (var i = 0; i < N; i++) {
            var len = routes[pr[i]].len;
            pd[i] += v * pv[i] * dt;
            if (pd[i] >= len) {
                pd[i] -= len;
                pj[i] = gauss() * (vertical ? 0.9 : 1.6);
            }
        }
    }

    // ── Animation loop ──────────────────────────────────────────────────
    var running = false, onScreen = false, raf = 0, lastT = 0, ready = false;
    function frame(now) {
        if (!running) return;
        var dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
        lastT = now;
        step(dt);
        render(1 - Math.pow(1 - 0.24, dt * 60));
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
        inspector.style.setProperty('--c', trackOf(st).color);
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
        if (reduceMotion && ready) render(0);
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

    // Stages switch on click only (hovering never changes them). While the
    // pointer is over the card the tour pauses; on touch screens a tap
    // pauses it for a while instead.
    var touchOnly = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
    els.forEach(function (el, i) {
        el.addEventListener('click', function () {
            if (vertical) return;
            setActive(i);
            if (touchOnly) {
                hovering = true;
                scheduleCycle();
                clearTimeout(resumeTimer);
                resumeTimer = setTimeout(function () { hovering = false; scheduleCycle(); }, 12000);
            }
        });
        el.addEventListener('keydown', function (e) {
            if (!vertical && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setActive(i); }
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
        initParticles();                 // routes are rebuilt on every layout
        ready = true;
        if (!vertical) {
            if (active < 0) setActive(0);
            else if (modeChanged) renderInspector(active);
        }
        if (vertical) trackScroll();
        if (reduceMotion) render(0);
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
