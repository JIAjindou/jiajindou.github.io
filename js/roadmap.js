/*
 * Research roadmap: the research directions in _data/roadmap.yml (embedded as
 * #roadmap-data) drawn as ribbons of particles flowing across the stages.
 * Each ribbon swells between stage nodes and pinches through them; particles
 * vary in size, brightness and speed, and a faint dust drifts behind. Side
 * tracks split from a shared start in smooth S-curves and merge again at the
 * end (a side-0 track would instead run the whole way).
 *
 * Desktop: stages as columns; clicking one shows its details and its robots,
 * large, in the panel underneath, which otherwise tours the stages. Narrow
 * screens: the ribbons run down the left edge and every stage's details are
 * inline. Pauses off-screen; a still frame for prefers-reduced-motion.
 */
(function () {
    'use strict';

    var root = document.getElementById('roadmap');
    var dataEl = document.getElementById('roadmap-data');
    if (!root || !dataEl) return;
    var data;
    try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
    var stages = data && data.stages, tracks = (data && data.tracks) || [];
    if (!stages || !stages.length || !tracks.length) return;

    var zh = (document.documentElement.lang || '').slice(0, 2) === 'zh';
    var imgBase = root.getAttribute('data-img-base') || '/images/hardware/';
    var labelWorks = root.getAttribute('data-label-works') || 'Key works';
    var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var CYCLE_MS = 6500;

    var trackByKey = {};
    tracks.forEach(function (t) { trackByKey[t.key] = t; });
    // A side-0 track is a trunk running the whole way. Otherwise the trunk is
    // implicit: only the shared start (before the tracks split) and the end
    // (after they merge), so the directions read as equals.
    var trunk = tracks.filter(function (t) { return !t.side; })[0] ||
        { key: 'trunk', color: (data.trunk && data.trunk.color) || '#5b6b7f', side: 0, implicit: true };
    function trackOf(st) { return trackByKey[st.track] || trunk; }

    function tr(o, k) { return (zh && o[k + '_zh']) || o[k] || ''; }
    function esc(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    // ── Theme ───────────────────────────────────────────────────────────
    // On the dark theme the colours keep their hue but are lifted to a
    // lightness that reads on a dark page (navy -> soft blue, teal -> cyan).
    function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
    function rgbOf(hex) {
        hex = hex.replace('#', '');
        return [0, 2, 4].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
    }
    function hexOf(rgb) {
        return '#' + rgb.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
    }
    function paint(hex) {
        if (!isDark()) return hex;
        var c = rgbOf(hex).map(function (v) { return v / 255; });
        var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
        var h = 0, s = 0, l = (mx + mn) / 2, d = mx - mn;
        if (d) {
            s = d / (1 - Math.abs(2 * l - 1));
            h = mx === c[0] ? ((c[1] - c[2]) / d) % 6 : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
            h *= 60;
        }
        l = Math.max(l, 0.66);
        var C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = l - C / 2;
        var rgb = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
        return hexOf(rgb.map(function (v) { return (v + m) * 255; }));
    }
    function mix(hex, toward, f) {
        var a = rgbOf(hex), b = rgbOf(toward);
        return hexOf(a.map(function (v, i) { return v + (b[i] - v) * f; }));
    }
    function rgba(hex, a) { return 'rgba(' + rgbOf(hex).join(',') + ',' + a + ')'; }

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

    // Legend of the directions (narrow screens, where the ribbons are too
    // close together to label inline).
    var legend = document.createElement('div');
    legend.className = 'rm-legend';
    legend.innerHTML = tracks.map(function (t) {
        return '<span><i></i>' + esc(tr(t, 'name')) + '</span>';
    }).join('');
    root.insertBefore(legend, wrap);
    var legendItems = legend.querySelectorAll('span');

    function worksHtml(st) {
        if (!st.works || !st.works.length) return '';
        return '<div class="rm-works">' + st.works.map(function (w) {
            return '<a class="rm-chip" href="#pub-' + esc(w.id) + '"><b>' + esc(w.venue) + '</b>' + esc(w.name) + '</a>';
        }).join('') + '</div>';
    }
    function robotsHtml(st, cls) {
        return (st.platforms || []).map(function (p) {
            return '<span class="' + cls + '"><img src="' + esc(imgBase + p) + '" alt="" loading="lazy" decoding="async"></span>';
        }).join('');
    }

    var n = stages.length, last = n - 1;
    var els = [], nodes = [];
    stages.forEach(function (st) {
        var el = document.createElement('div');
        el.className = 'rm-stage' + (st.key === 'next' ? ' rm-next' : '');
        el.setAttribute('tabindex', '0');
        el.innerHTML =
            '<div class="rm-head"><span class="rm-idx">' + esc(st.index || '') + '</span>' +
            '<span class="rm-title">' + esc(tr(st, 'title')) + '</span>' +
            '<span class="rm-years">' + esc(tr(st, 'years')) + '</span></div>' +
            '<div class="rm-flow"></div>' +
            '<div class="rm-robots">' + robotsHtml(st, 'rm-robot') + '</div>' +
            '<div class="rm-detail"><p>' + esc(tr(st, 'desc')) + '</p>' + worksHtml(st) + '</div>';
        wrap.appendChild(el);
        els.push(el);
        var node = document.createElement('span');
        node.className = 'rm-node';
        wrap.appendChild(node);
        nodes.push(node);
    });

    var labels = tracks.map(function (t) {
        var lb = document.createElement('span');
        lb.className = 'rm-track-label';
        lb.textContent = tr(t, 'name');
        wrap.appendChild(lb);
        return lb;
    });

    // --c on every coloured element, for the current theme.
    function applyColors() {
        stages.forEach(function (st, i) {
            var c = paint(trackOf(st).color);
            els[i].style.setProperty('--c', c);
            nodes[i].style.setProperty('--c', c);
        });
        tracks.forEach(function (t, i) {
            var c = paint(t.color);
            labels[i].style.setProperty('--c', c);
            legendItems[i].style.setProperty('--c', c);
        });
    }
    applyColors();

    // ── Geometry ────────────────────────────────────────────────────────
    // Routes are laid out in (m, c): m runs along the stages, c across them
    // (0 = trunk). toXY maps them to the screen for either orientation.
    var D = 46, CORNER = 28, MARGIN = 38, SPLIT = 36;
    var W = 0, H = 0, dpr = 1, vertical = false, k = 1, cross = 0, rail = 26;
    var col = [], lines = [], journeys = [];

    var above = 0, below = 0;
    tracks.forEach(function (t) {
        if (t.side < 0) above = D;
        if (t.side > 0) below = D;
    });
    var flowH = MARGIN + above + below + MARGIN;
    els.forEach(function (el) { el.querySelector('.rm-flow').style.height = flowH + 'px'; });

    function toXY(m, c) { return vertical ? [rail + c * k, m] : [m, cross + c]; }

    // Polyline through pts with rounded corners, resampled every STEP px,
    // with unit normals.
    var STEP = 1.5;
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
            for (var q = 1; q <= 12; q++) {      // rounded corner (quadratic Bézier)
                var t = q / 12, u = 1 - t;
                poly.push([u * u * p1[0] + 2 * u * t * b[0] + t * t * p2[0],
                           u * u * p1[1] + 2 * u * t * b[1] + t * t * p2[1]]);
            }
        }
        poly.push(P[P.length - 1]);
        var xs = [poly[0][0]], ys = [poly[0][1]], carry = 0;
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
        rt.x = new Float32Array(xs);
        rt.y = new Float32Array(ys);
        rt.nx = new Float32Array(m);
        rt.ny = new Float32Array(m);
        for (i = 0; i < m; i++) {
            var j0 = Math.max(0, i - 2), j1 = Math.min(m - 1, i + 2);
            var tx = rt.x[j1] - rt.x[j0], ty = rt.y[j1] - rt.y[j0], len = Math.hypot(tx, ty) || 1;
            rt.nx[i] = -ty / len;
            rt.ny[i] = tx / len;
        }
        rt.len = (m - 1) * STEP;
        return rt;
    }

    // lines: faint guides drawn once; journeys: the paths particles travel
    // (start -> one track -> end), so both colours set off together, part at
    // the split and meet again at the merge.
    function buildRoutes() {
        lines = [];
        journeys = [];
        var mStart = col[0].l + 2, mEnd = col[last].r - 2, mMerge = col[last].c - 12;
        function branchAt(t) { return col[Math.min(t.from || 1, last)].l; }
        var side = tracks.filter(function (t) { return t.side; });
        var hasTrunkTrack = tracks.some(function (t) { return !t.side; });
        if (trunk.implicit) {
            var split = Math.min.apply(null, side.map(branchAt).concat([mMerge])) - SPLIT;
            lines.push({ track: trunk, pts: [[mStart, 0], [split, 0]] });
            lines.push({ track: trunk, pts: [[mMerge, 0], [mEnd, 0]] });
        }
        tracks.forEach(function (t) {
            if (!t.side) {
                var whole = [[mStart, 0], [mEnd, 0]];
                lines.push({ track: t, pts: whole });
                journeys.push({ track: t, pts: whole });
                return;
            }
            var b = branchAt(t), off = t.side * D;
            var branch = [[b - SPLIT, 0], [b + SPLIT, off], [mMerge - 2 * SPLIT, off], [mMerge, 0]];
            lines.push({ track: t, pts: branch });
            journeys.push({ track: t, pts: hasTrunkTrack ? branch : [[mStart, 0]].concat(branch, [[mEnd, 0]]) });
        });
        lines.forEach(sampleRoute);
        lines.forEach(function (rt) { rt.paint = paint(rt.track.color); });
        journeys.forEach(function (rt) {
            sampleRoute(rt);
            shapeRibbon(rt);
            var base = paint(rt.track.color);
            // Three depths: the line colour, and two lighter tints of it.
            rt.colors = [base, mix(base, '#ffffff', isDark() ? 0.3 : 0.35), mix(base, '#ffffff', isDark() ? 0.6 : 0.62)];
        });
    }

    // Ribbon half-width at each sample: narrow through the stage nodes on this
    // journey, swelling in between; tapering to nothing at both ends.
    function shapeRibbon(rt) {
        var pins = [];
        stages.forEach(function (st, i) {
            var t = trackOf(st);
            if (t !== rt.track && t !== trunk) return;
            var p = toXY(col[i].c, i === last ? 0 : (t.side || 0) * D), best = 0, bd = 1e9;
            for (var s = 0; s < rt.x.length; s += 2) {
                var d = (rt.x[s] - p[0]) * (rt.x[s] - p[0]) + (rt.y[s] - p[1]) * (rt.y[s] - p[1]);
                if (d < bd) { bd = d; best = s; }
            }
            if (bd < 16) pins.push(best * STEP);
        });
        var wMin = vertical ? 1 : 1.6, wMax = vertical ? 3.4 : 7, reach = vertical ? 46 : 74;
        var m = rt.x.length;
        rt.w = new Float32Array(m);
        for (var i = 0; i < m; i++) {
            var d = i * STEP, near = 1e9;
            for (var q = 0; q < pins.length; q++) near = Math.min(near, Math.abs(d - pins[q]));
            var f = 1 - Math.exp(-(near * near) / (reach * reach));
            var taper = Math.min(1, d / 60, (rt.len - d) / 60);
            rt.w[i] = (wMin + (wMax - wMin) * f) * Math.max(0, taper);
        }
    }

    function layout() {
        vertical = window.innerWidth < 769;
        k = vertical ? 0.34 : 1;
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
            cross = f.top - wr.top + MARGIN + above;
        }
        buildRoutes();

        nodes.forEach(function (nd, i) {
            var t = trackOf(stages[i]);
            var p = toXY(col[i].c, i === last ? 0 : (t.side || 0) * D);
            nd.style.left = p[0] + 'px';
            nd.style.top = p[1] + 'px';
        });
        // Each direction's name rides on the outer side of its ribbon, just
        // after its first node.
        labels.forEach(function (lb, i) {
            var t = tracks[i];
            var start = col[Math.min(t.label_from != null ? t.label_from : (t.side ? t.from || 1 : 0), last)];
            var off = (t.side || 0) * D;
            var p = toXY(start.c + 16, t.side > 0 ? off + 24 : off - 24);
            lb.style.left = p[0] + 'px';
            lb.style.top = p[1] + 'px';
        });
        drawStatic();
        return true;
    }

    // ── Static layer: faint guides under the ribbons ────────────────────
    function drawStatic() {
        var c = bg.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, W, H);
        c.lineCap = 'round';
        lines.forEach(function (rt) {
            c.beginPath();
            for (var i = 0; i < rt.x.length; i++) {
                if (i === 0) c.moveTo(rt.x[i], rt.y[i]); else c.lineTo(rt.x[i], rt.y[i]);
            }
            c.strokeStyle = rgba(rt.paint, isDark() ? 0.22 : 0.16);
            c.lineWidth = 1;
            c.stroke();
        });
    }

    // ── Particles ───────────────────────────────────────────────────────
    // Ribbon particles: journey, position along it, lateral offset (in
    // ribbon half-widths), wobble phase/frequency, speed, size, alpha, tint.
    var N = 0, pj, pd, pu, pph, pf, pv, ps, pa, pt;
    // Dust: a sparse, slow drift behind the ribbons.
    var M = 0, dx, dy, dv, dph, ds, da;

    function gauss() {
        var u = 0;
        while (!u) u = Math.random();
        var g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
        return g > 2.6 ? 2.6 : g < -2.6 ? -2.6 : g;
    }
    function seed(i, j) {
        pj[i] = j;
        pu[i] = gauss();
        pph[i] = Math.random() * Math.PI * 2;
        pf[i] = 0.6 + Math.random() * 1.6;
        pv[i] = 0.55 + Math.random() * 0.9;                 // layered speeds = depth
        var r = Math.random();
        ps[i] = r < 0.05 ? 1.15 + Math.random() * 0.5 : 0.32 + Math.random() * 0.62;   // radius; a few sparkles
        pa[i] = r < 0.05 ? 0.95 : 0.4 + Math.random() * 0.55;
        pt[i] = r < 0.05 ? 0 : (Math.random() < 0.5 ? 0 : Math.random() < 0.6 ? 1 : 2);
    }
    function initParticles() {
        // Particles per px of ribbon; phones get fewer (longer ribbons, slower GPUs).
        var dens = vertical ? 0.9 : 4.2, cap = vertical ? 1800 : 4200;
        var counts = journeys.map(function (rt) { return Math.min(cap, Math.round(rt.len * dens)); });
        N = counts.reduce(function (a, b) { return a + b; }, 0);
        pj = new Uint8Array(N); pd = new Float32Array(N); pu = new Float32Array(N);
        pph = new Float32Array(N); pf = new Float32Array(N); pv = new Float32Array(N);
        ps = new Float32Array(N); pa = new Float32Array(N); pt = new Uint8Array(N);
        var i = 0;
        counts.forEach(function (cnt, j) {
            for (var q = 0; q < cnt; q++, i++) {
                seed(i, j);
                pd[i] = Math.random() * journeys[j].len;
            }
        });
        // Dust over the band the ribbons occupy.
        M = vertical ? 50 : 160;
        dx = new Float32Array(M); dy = new Float32Array(M); dv = new Float32Array(M);
        dph = new Float32Array(M); ds = new Float32Array(M); da = new Float32Array(M);
        for (i = 0; i < M; i++) {
            dx[i] = Math.random() * W;
            dy[i] = Math.random();
            dv[i] = 6 + Math.random() * 14;
            dph[i] = Math.random() * Math.PI * 2;
            ds[i] = 0.5 + Math.random() * 0.8;
            da[i] = 0.12 + Math.random() * 0.22;
        }
    }

    var ctx = fx.getContext('2d');
    var LEVELS = [0.32, 0.6, 0.92];
    var buckets = [];

    function step(dt) {
        var v = vertical ? 30 : 44;     // px per second
        for (var i = 0; i < N; i++) {
            var len = journeys[pj[i]].len;
            pd[i] += v * pv[i] * dt;
            if (pd[i] >= len) {
                pd[i] -= len;
                pu[i] = gauss();
            }
        }
        var span = vertical ? H : W;
        for (i = 0; i < M; i++) {
            dx[i] += dv[i] * dt;
            if (dx[i] > span) dx[i] -= span;
        }
    }

    function render(time) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        var dark = isDark();
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';

        // Dust first, behind everything.
        var dust = paint(trunk.color), bandTop, bandH;
        if (!vertical) { bandTop = cross - above - MARGIN * 0.8; bandH = above + below + MARGIN * 1.6; }
        ctx.fillStyle = dust;
        for (var i = 0; i < M; i++) {
            var x, y, wob = Math.sin(time * 0.4 + dph[i]) * 6;
            if (!vertical) { x = dx[i]; y = bandTop + dy[i] * bandH + wob; }
            else { y = dx[i]; x = 4 + dy[i] * 46 + wob * 0.4; }
            ctx.globalAlpha = da[i] * (dark ? 1.3 : 1);
            ctx.beginPath();
            ctx.arc(x, y, ds[i], 0, Math.PI * 2);
            ctx.fill();
        }

        // Ribbons, batched by journey x tint x alpha level.
        var nb = journeys.length * 9;
        while (buckets.length < nb) buckets.push([]);
        for (var b = 0; b < nb; b++) buckets[b].length = 0;
        // The active stage's stretch of its own ribbon glows a little more.
        var lo = active >= 0 && !vertical ? col[active].l : -1, hi = lo >= 0 ? col[active].r : -1;
        var hot = lo >= 0 ? trackOf(stages[active]) : null;
        for (i = 0; i < N; i++) {
            var rt = journeys[pj[i]], d = pd[i];
            var s = Math.min(rt.x.length - 1, (d / STEP) | 0);
            var w = rt.w[s];
            if (w <= 0.05) continue;
            var off = pu[i] * w + Math.sin(time * pf[i] + pph[i]) * w * 0.18;
            x = rt.x[s] + rt.nx[s] * off;
            y = rt.y[s] + rt.ny[s] * off;
            var a = pa[i] * Math.min(1, w / 1.4), size = ps[i];
            if (hot && x >= lo && x <= hi && (rt.track === hot || hot === trunk)) { a = Math.min(1, a * 1.35); size *= 1.15; }
            if (a < 0.08) continue;
            var lv = a < 0.45 ? 0 : a < 0.75 ? 1 : 2;
            buckets[pj[i] * 9 + pt[i] * 3 + lv].push(x, y, size);
        }
        for (b = 0; b < nb; b++) {
            var arr = buckets[b];
            if (!arr.length) continue;
            var jj = (b / 9) | 0, tint = ((b % 9) / 3) | 0;
            ctx.globalAlpha = LEVELS[b % 3];
            ctx.fillStyle = journeys[jj].colors[tint];
            ctx.beginPath();
            for (var p = 0; p < arr.length; p += 3) {
                ctx.moveTo(arr[p] + arr[p + 2], arr[p + 1]);
                ctx.arc(arr[p], arr[p + 1], arr[p + 2], 0, Math.PI * 2);
            }
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    // ── Animation loop ──────────────────────────────────────────────────
    var running = false, onScreen = false, raf = 0, lastT = 0, clock = 0, ready = false;
    function frame(now) {
        if (!running) return;
        var dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
        lastT = now;
        clock += dt;
        step(dt);
        render(clock);
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
    var active = -1, cycleTimer = 0, hovering = false, resumeTimer = 0;

    function renderInspector(i) {
        var st = stages[i];
        inspector.style.setProperty('--c', paint(trackOf(st).color));
        var works = st.works && st.works.length
            ? '<div class="rm-works-label">' + esc(labelWorks) + '</div>' + worksHtml(st) : '';
        var gallery = st.platforms && st.platforms.length
            ? '<div class="rm-insp-robots rm-in">' + robotsHtml(st, 'rm-insp-robot') + '</div>' : '';
        inspector.classList.toggle('has-robots', !!gallery);
        inspector.innerHTML =
            '<div class="rm-insp-head rm-in"><span class="rm-idx">' + esc(st.index || '') + '</span>' +
            '<span class="rm-insp-title">' + esc(tr(st, 'title')) + '</span>' +
            '<span class="rm-years">' + esc(tr(st, 'years')) + '</span></div>' +
            '<div class="rm-insp-body rm-in"><p>' + esc(tr(st, 'desc')) + '</p>' + works + '</div>' + gallery;
    }

    function setActive(i) {
        if (i === active) return;
        active = i;
        root.classList.toggle('has-active', i >= 0);
        els.forEach(function (el, j) { el.classList.toggle('is-active', j === i); });
        nodes.forEach(function (nd, j) { nd.classList.toggle('is-active', j === i); });
        if (i >= 0 && !vertical) renderInspector(i);
        if (ready && (reduceMotion || !running)) render(clock);
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
    // pointer is over the roadmap the tour pauses; on touch screens a tap
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

    // ── Boot / resize / theme / visibility ──────────────────────────────
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
        if (reduceMotion) {
            for (var i = 0; i < 4; i++) step(0.4);
            render(0);
        }
        scheduleCycle();
        start();
    }

    document.addEventListener('themechange', function () {
        applyColors();
        if (!ready) return;
        relayout();
        if (active >= 0 && !vertical) renderInspector(active);
        if (!running) render(clock);
    });

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
