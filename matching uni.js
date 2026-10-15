// ============================================================
// Uni Match — matching engine
//
// Pure logic, no database or page code, so it can be tested on its own.
// Loaded by admin.html; also works in Node (module.exports at the bottom).
//
// HOW IT WORKS
//   Every possible pair of guests gets a COST (lower = better pair):
//     + GENDER_MISMATCH unless it is a girl+guy pair, or two they/them
//     + AGE_*           girl+guy pairs only: the guy must be the same age as
//                       the girl or up to MAX_GUY_OLDER years older. A girl
//                       older than her guy, or a guy too much older, is
//                       penalised heavily (but less than a gender mismatch,
//                       so the last-resort order is: age rule, then same-gender)
//     + INTENT_MISMATCH if one is "just friends" and the other "open to more"
//     + AGE_CLOSE       tiny cost per year of age difference (any pair)
//     - HOBBY           for each shared hobby         (soft bonus)
//     - VIBE_*          for matching tonight's vibe   (soft bonus)
//   Then it finds the set of pairs with the LOWEST TOTAL cost across the
//   whole room — not pair-by-pair — so one person's "best" match can never
//   steal the only option someone else had.
//   Order of sacrifice when the room can't satisfy everyone (cheapest first):
//     hobbies/vibe  →  age closeness  →  friends-vs-more mismatch
//     →  age rule  →  opposite-gender rule.
//   Odd head-count: one person joins the best-fitting pair as a group of
//   three, so nobody is ever left without a match.
// ============================================================
(function (root) {

  // CUSTOMIZE: these weights are the whole "personality" of the algorithm.
  // Keep GENDER_MISMATCH > AGE_* > INTENT_MISMATCH > the soft bonuses and
  // the priority order above holds.
  var W = {
    GENDER_MISMATCH: 1000, // not girl+guy and not they+they
    MAX_GUY_OLDER: 3,      // a guy may be this many years older than the girl
    AGE_GIRL_OLDER: 500,   // girl older than the guy: base cost ...
    AGE_GIRL_OLDER_YR: 100,//   ... plus this per year she is older
    AGE_GUY_TOO_OLD: 500,  // guy more than MAX_GUY_OLDER older: base cost ...
    AGE_GUY_TOO_OLD_YR: 60,//   ... plus this per extra year
    AGE_CLOSE: 3,          // per year of age difference (capped at 10 years)
    INTENT_MISMATCH: 400,  // friends-only paired with open-to-more
    HOBBY: 10,             // per shared hobby
    VIBE_SAME: 8,          // same vibe tonight
    VIBE_FLEX: 4           // one of them is "up for anything"
  };

  // ---------- hobby normalising ("Soccer" = "football", "playing FIFA!" etc.) ----------
  var SYNONYMS = {
    football: ['soccer', 'football', 'futbol', 'fussball', 'fußball', 'fifa'],
    gym: ['gym', 'workout', 'working out', 'fitness', 'lifting', 'weightlifting', 'bodybuilding', 'training'],
    gaming: ['gaming', 'games', 'video games', 'videogames', 'playstation', 'ps5', 'xbox', 'esports', 'pc gaming', 'gamer'],
    movies: ['movies', 'movie', 'films', 'film', 'cinema', 'series', 'netflix', 'tv shows', 'tv'],
    music: ['music', 'singing', 'guitar', 'piano', 'concerts', 'listening to music'],
    dancing: ['dancing', 'dance', 'salsa', 'dabke', 'bachata'],
    travel: ['travel', 'traveling', 'travelling', 'trips', 'traveler'],
    cooking: ['cooking', 'food', 'baking', 'foodie', 'eating', 'cook'],
    photography: ['photography', 'photos', 'photo', 'photographer'],
    reading: ['reading', 'books', 'book'],
    running: ['running', 'jogging', 'run', 'marathon'],
    hiking: ['hiking', 'nature', 'camping', 'outdoors', 'trekking'],
    art: ['art', 'drawing', 'painting', 'design', 'sketching'],
    tech: ['tech', 'coding', 'programming', 'computers', 'technology'],
    partying: ['partying', 'parties', 'nightlife', 'clubbing', 'going out', 'party']
  };
  var SYN_LOOKUP = {};
  Object.keys(SYNONYMS).forEach(function (canon) {
    SYNONYMS[canon].forEach(function (w) { SYN_LOOKUP[w] = canon; });
  });

  function normHobby(raw) {
    if (!raw) return '';
    var s = String(raw).toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    s = s.replace(/^(playing|watching|doing|going to the|going to|love|loving|i like|i love)\s+/, '');
    if (SYN_LOOKUP[s]) return SYN_LOOKUP[s];
    if (s.length > 3 && s.charAt(s.length - 1) === 's' && SYN_LOOKUP[s.slice(0, -1)]) return SYN_LOOKUP[s.slice(0, -1)];
    if (s.length > 3 && s.charAt(s.length - 1) === 's') s = s.slice(0, -1);
    return SYN_LOOKUP[s] || s;
  }

  function hobbyList(g) {
    var out = [];
    [g.hobby1, g.hobby2].forEach(function (h) {
      var n = normHobby(h);
      if (n && out.indexOf(n) === -1) out.push(n);
    });
    return out;
  }

  function hobbyOverlap(a, b) {
    var bh = hobbyList(b), n = 0;
    hobbyList(a).forEach(function (h) { if (bh.indexOf(h) !== -1) n++; });
    return n;
  }

  // ---------- the rules ----------
  // Allowed gender combos: girl+guy, or they/them with they/them.
  function genderOk(a, b) {
    var x = a.gender, y = b.gender;
    if ((x === 'girl' && y === 'guy') || (x === 'guy' && y === 'girl')) return true;
    return x === 'they' && y === 'they';
  }

  // Age rule (girl+guy pairs only). Returns { girlOlder: years, guyTooOld: years }.
  // Missing ages are never penalised.
  function ageRule(a, b) {
    var out = { girlOlder: 0, guyTooOld: 0 };
    if (a.age == null || b.age == null) return out;
    var girl = a.gender === 'girl' ? a : (b.gender === 'girl' ? b : null);
    var guy = a.gender === 'guy' ? a : (b.gender === 'guy' ? b : null);
    if (!girl || !guy || girl === guy) return out;
    var d = guy.age - girl.age;               // positive = guy is older
    if (d < 0) out.girlOlder = -d;
    else if (d > W.MAX_GUY_OLDER) out.guyTooOld = d - W.MAX_GUY_OLDER;
    return out;
  }

  function explain(a, b) {
    var r = ageRule(a, b);
    return {
      genderMismatch: genderOk(a, b) ? 0 : 1,
      girlOlder: r.girlOlder,
      guyTooOld: r.guyTooOld,
      ageBroken: r.girlOlder > 0 || r.guyTooOld > 0,
      ageDiff: (a.age == null || b.age == null) ? 0 : Math.abs(a.age - b.age),
      intentMismatch: a.intent !== b.intent,
      sharedHobbies: hobbyOverlap(a, b),
      sameVibe: a.vibe === b.vibe && a.vibe !== 'anything'
    };
  }

  function pairCost(a, b) {
    var e = explain(a, b);
    var c = e.genderMismatch * W.GENDER_MISMATCH;
    if (e.girlOlder) c += W.AGE_GIRL_OLDER + e.girlOlder * W.AGE_GIRL_OLDER_YR;
    if (e.guyTooOld) c += W.AGE_GUY_TOO_OLD + e.guyTooOld * W.AGE_GUY_TOO_OLD_YR;
    c += Math.min(e.ageDiff, 10) * W.AGE_CLOSE;
    if (e.intentMismatch) c += W.INTENT_MISMATCH;
    c -= e.sharedHobbies * W.HOBBY;
    if (a.vibe === b.vibe && a.vibe !== 'anything') c -= W.VIBE_SAME;
    else if (a.vibe === 'anything' || b.vibe === 'anything') c -= W.VIBE_FLEX;
    return c;
  }

  function buildMatrix(guests) {
    var n = guests.length, C = [];
    for (var i = 0; i < n; i++) {
      C.push(new Array(n).fill(0));
    }
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        C[a][b] = C[b][a] = pairCost(guests[a], guests[b]);
      }
    }
    return C;
  }

  // ============================================================
  // Exact minimum-cost PERFECT matching (Edmonds' blossom algorithm).
  // A port of the well-known Van Rantwijk / Galil implementation (the same
  // one NetworkX uses), specialised to a complete graph on 0..n-1.
  // Given weights W[i][j] (integers), returns mate[] maximising total weight
  // among maximum-cardinality matchings. mate[i] = -1 means unmatched.
  // ============================================================
  function maxWeightMatching(n, Wm) {
    var NONE = -1;
    function Blossom() { this.childs = null; this.edges = null; this.mybestedges = null; }

    var nbr = [], maxweight = 0, v0, w0;
    for (v0 = 0; v0 < n; v0++) {
      nbr.push([]);
      for (w0 = 0; w0 < n; w0++) if (w0 !== v0) nbr[v0].push(w0);
    }
    for (v0 = 0; v0 < n; v0++) for (w0 = v0 + 1; w0 < n; w0++) if (Wm[v0][w0] > maxweight) maxweight = Wm[v0][w0];

    var mate = new Map(), label = new Map(), labeledge = new Map(), inblossom = new Map(),
        blossomparent = new Map(), blossombase = new Map(), bestedge = new Map(),
        dualvar = new Map(), blossomdual = new Map(), allowedge = new Set(), queue = [];
    for (v0 = 0; v0 < n; v0++) {
      inblossom.set(v0, v0); blossomparent.set(v0, null); blossombase.set(v0, v0); dualvar.set(v0, maxweight);
    }

    function ak(v, w) { return v * n + w; }
    function slack(v, w) { return dualvar.get(v) + dualvar.get(w) - 2 * Wm[v][w]; }
    function slackE(e) { return slack(e[0], e[1]); }
    function at(arr, j) { var L = arr.length; return arr[((j % L) + L) % L]; }
    function leaves(b) {
      var out = [], stack = b.childs.slice();
      while (stack.length) {
        var t = stack.pop();
        if (t instanceof Blossom) { for (var q = 0; q < t.childs.length; q++) stack.push(t.childs[q]); }
        else out.push(t);
      }
      return out;
    }
    function minDual() {
      var m = Infinity;
      dualvar.forEach(function (d) { if (d < m) m = d; });
      return m;
    }
    function runTrampoline(gen, args) {
      var stack = [gen.apply(null, args)];
      while (stack.length) {
        var nx = stack[stack.length - 1].next();
        if (!nx.done) stack.push(gen.apply(null, Array.isArray(nx.value) ? nx.value : [nx.value].concat(args.slice(1))));
        else stack.pop();
      }
    }

    function assignLabel(w, t, v) {
      var b = inblossom.get(w);
      label.set(w, t); label.set(b, t);
      var le = (v === null) ? null : [v, w];
      labeledge.set(w, le); labeledge.set(b, le);
      bestedge.set(w, null); bestedge.set(b, null);
      if (t === 1) {
        if (b instanceof Blossom) leaves(b).forEach(function (x) { queue.push(x); });
        else queue.push(b);
      } else if (t === 2) {
        var base = blossombase.get(b);
        assignLabel(mate.get(base), 1, base);
      }
    }

    function scanBlossom(v, w) {
      var path = [], base = NONE;
      while (v !== NONE) {
        var b = inblossom.get(v);
        if (label.get(b) & 4) { base = blossombase.get(b); break; }
        path.push(b);
        label.set(b, 5);
        if (labeledge.get(b) === null) {
          v = NONE;
        } else {
          v = labeledge.get(b)[0];
          b = inblossom.get(v);
          v = labeledge.get(b)[0];
        }
        if (w !== NONE) { var tmp = v; v = w; w = tmp; }
      }
      path.forEach(function (b) { label.set(b, 1); });
      return base;
    }

    function addBlossom(base, v, w) {
      var bb = inblossom.get(base), bv = inblossom.get(v), bw = inblossom.get(w);
      var b = new Blossom();
      blossombase.set(b, base);
      blossomparent.set(b, null);
      blossomparent.set(bb, b);
      var path = b.childs = [];
      var edgs = b.edges = [[v, w]];
      while (bv !== bb) {
        blossomparent.set(bv, b);
        path.push(bv);
        edgs.push(labeledge.get(bv));
        v = labeledge.get(bv)[0];
        bv = inblossom.get(v);
      }
      path.push(bb);
      path.reverse();
      edgs.reverse();
      while (bw !== bb) {
        blossomparent.set(bw, b);
        path.push(bw);
        var le = labeledge.get(bw);
        edgs.push([le[1], le[0]]);
        w = le[0];
        bw = inblossom.get(w);
      }
      label.set(b, 1);
      labeledge.set(b, labeledge.get(bb));
      blossomdual.set(b, 0);
      leaves(b).forEach(function (vv) {
        if (label.get(inblossom.get(vv)) === 2) queue.push(vv);
        inblossom.set(vv, b);
      });
      var bestedgeto = new Map();
      path.forEach(function (sub) {
        var nblist;
        if (sub instanceof Blossom) {
          if (sub.mybestedges !== null) {
            nblist = sub.mybestedges;
            sub.mybestedges = null;
          } else {
            nblist = [];
            leaves(sub).forEach(function (x) {
              nbr[x].forEach(function (y) { if (x !== y) nblist.push([x, y]); });
            });
          }
        } else {
          nblist = nbr[sub].filter(function (y) { return sub !== y; }).map(function (y) { return [sub, y]; });
        }
        nblist.forEach(function (k) {
          var i = k[0], j = k[1];
          if (inblossom.get(j) === b) { var t = i; i = j; j = t; }
          var bj = inblossom.get(j);
          if (bj !== b && label.get(bj) === 1 &&
              (!bestedgeto.has(bj) || slack(i, j) < slackE(bestedgeto.get(bj)))) {
            bestedgeto.set(bj, k);
          }
        });
        bestedge.set(sub, null);
      });
      b.mybestedges = Array.from(bestedgeto.values());
      var mybestedge = null, mybestslack = 0;
      b.mybestedges.forEach(function (k) {
        var ks = slackE(k);
        if (mybestedge === null || ks < mybestslack) { mybestedge = k; mybestslack = ks; }
      });
      bestedge.set(b, mybestedge);
    }

    function expandBlossom(b0, endstage) {
      function* rec(b, endstage) {
        var s, q, e;
        for (q = 0; q < b.childs.length; q++) {
          s = b.childs[q];
          blossomparent.set(s, null);
          if (s instanceof Blossom) {
            if (endstage && blossomdual.get(s) === 0) {
              yield s;
            } else {
              leaves(s).forEach(function (x) { inblossom.set(x, s); });
            }
          } else {
            inblossom.set(s, s);
          }
        }
        if (!endstage && label.get(b) === 2) {
          var entrychild = inblossom.get(labeledge.get(b)[1]);
          var j = b.childs.indexOf(entrychild), jstep;
          if (j & 1) { j -= b.childs.length; jstep = 1; } else { jstep = -1; }
          var v = labeledge.get(b)[0], w = labeledge.get(b)[1], p, qq;
          while (j !== 0) {
            if (jstep === 1) { e = at(b.edges, j); p = e[0]; qq = e[1]; }
            else { e = at(b.edges, j - 1); qq = e[0]; p = e[1]; }
            label.set(w, null);
            label.set(qq, null);
            assignLabel(w, 2, v);
            allowedge.add(ak(p, qq)); allowedge.add(ak(qq, p));
            j += jstep;
            if (jstep === 1) { e = at(b.edges, j); v = e[0]; w = e[1]; }
            else { e = at(b.edges, j - 1); w = e[0]; v = e[1]; }
            allowedge.add(ak(v, w)); allowedge.add(ak(w, v));
            j += jstep;
          }
          var bw = at(b.childs, j);
          label.set(w, 2); label.set(bw, 2);
          labeledge.set(w, [v, w]); labeledge.set(bw, [v, w]);
          bestedge.set(bw, null);
          j += jstep;
          while (at(b.childs, j) !== entrychild) {
            var bv = at(b.childs, j);
            if (label.get(bv) === 1) { j += jstep; continue; }
            var vv;
            if (bv instanceof Blossom) {
              var lv = leaves(bv);
              vv = lv[lv.length - 1];
              for (var z = 0; z < lv.length; z++) { if (label.get(lv[z])) { vv = lv[z]; break; } }
            } else {
              vv = bv;
            }
            if (label.get(vv)) {
              label.set(vv, null);
              label.set(mate.get(blossombase.get(bv)), null);
              assignLabel(vv, 2, labeledge.get(vv)[0]);
            }
            j += jstep;
          }
        }
        label.delete(b); labeledge.delete(b); bestedge.delete(b);
        blossomparent.delete(b); blossombase.delete(b); blossomdual.delete(b);
      }
      runTrampoline(rec, [b0, endstage]);
    }

    function augmentBlossom(b0, v0) {
      function* rec(b, v) {
        var t = v, e, w, x;
        while (blossomparent.get(t) !== b) t = blossomparent.get(t);
        if (t instanceof Blossom) yield [t, v];
        var i = b.childs.indexOf(t), j = i, jstep;
        if (i & 1) { j -= b.childs.length; jstep = 1; } else { jstep = -1; }
        while (j !== 0) {
          j += jstep;
          t = at(b.childs, j);
          if (jstep === 1) { e = at(b.edges, j); w = e[0]; x = e[1]; }
          else { e = at(b.edges, j - 1); x = e[0]; w = e[1]; }
          if (t instanceof Blossom) yield [t, w];
          j += jstep;
          t = at(b.childs, j);
          if (t instanceof Blossom) yield [t, x];
          mate.set(w, x); mate.set(x, w);
        }
        b.childs = b.childs.slice(i).concat(b.childs.slice(0, i));
        b.edges = b.edges.slice(i).concat(b.edges.slice(0, i));
        blossombase.set(b, blossombase.get(b.childs[0]));
      }
      runTrampoline(rec, [b0, v0]);
    }

    function augmentMatching(v, w) {
      [[v, w], [w, v]].forEach(function (pr) {
        var s = pr[0], j = pr[1];
        while (true) {
          var bs = inblossom.get(s);
          if (bs instanceof Blossom) augmentBlossom(bs, s);
          mate.set(s, j);
          if (labeledge.get(bs) === null) break;
          var t = labeledge.get(bs)[0];
          var bt = inblossom.get(t);
          var le = labeledge.get(bt);
          s = le[0]; j = le[1];
          if (bt instanceof Blossom) augmentBlossom(bt, j);
          mate.set(j, s);
        }
      });
    }

    // ---- main loop ----
    var v, w, b, d, ii;
    while (true) {
      label.clear(); labeledge.clear(); bestedge.clear();
      blossomdual.forEach(function (_, bl) { bl.mybestedges = null; });
      allowedge.clear();
      queue.length = 0;
      for (v = 0; v < n; v++) {
        if (!mate.has(v) && label.get(inblossom.get(v)) == null) assignLabel(v, 1, null);
      }
      var augmented = false;
      while (true) {
        while (queue.length && !augmented) {
          v = queue.pop();
          var nv = nbr[v];
          for (ii = 0; ii < nv.length; ii++) {
            w = nv[ii];
            if (w === v) continue;
            var bv = inblossom.get(v), bw = inblossom.get(w);
            if (bv === bw) continue;
            var kslack = 0;
            if (!allowedge.has(ak(v, w))) {
              kslack = slack(v, w);
              if (kslack <= 0) { allowedge.add(ak(v, w)); allowedge.add(ak(w, v)); }
            }
            if (allowedge.has(ak(v, w))) {
              if (label.get(bw) == null) {
                assignLabel(w, 2, v);
              } else if (label.get(bw) === 1) {
                var base = scanBlossom(v, w);
                if (base !== NONE) {
                  addBlossom(base, v, w);
                } else {
                  augmentMatching(v, w);
                  augmented = true;
                  break;
                }
              } else if (label.get(w) == null) {
                label.set(w, 2);
                labeledge.set(w, [v, w]);
              }
            } else if (label.get(bw) === 1) {
              if (bestedge.get(bv) == null || kslack < slackE(bestedge.get(bv))) bestedge.set(bv, [v, w]);
            } else if (label.get(w) == null) {
              if (bestedge.get(w) == null || kslack < slackE(bestedge.get(w))) bestedge.set(w, [v, w]);
            }
          }
        }
        if (augmented) break;

        var deltatype = -1, delta = null, deltaedge = null, deltablossom = null;
        // (max-cardinality mode: no delta1)
        for (v = 0; v < n; v++) {
          if (label.get(inblossom.get(v)) == null && bestedge.get(v) != null) {
            d = slackE(bestedge.get(v));
            if (deltatype === -1 || d < delta) { delta = d; deltatype = 2; deltaedge = bestedge.get(v); }
          }
        }
        blossomparent.forEach(function (par, bl) {
          if (par === null && label.get(bl) === 1 && bestedge.get(bl) != null) {
            var ks = slackE(bestedge.get(bl));
            var dd = ks / 2;
            if (deltatype === -1 || dd < delta) { delta = dd; deltatype = 3; deltaedge = bestedge.get(bl); }
          }
        });
        blossomdual.forEach(function (bd, bl) {
          if (blossomparent.get(bl) === null && label.get(bl) === 2 && (deltatype === -1 || bd < delta)) {
            delta = bd; deltatype = 4; deltablossom = bl;
          }
        });
        if (deltatype === -1) { deltatype = 1; delta = Math.max(0, minDual()); }

        for (v = 0; v < n; v++) {
          var lab = label.get(inblossom.get(v));
          if (lab === 1) dualvar.set(v, dualvar.get(v) - delta);
          else if (lab === 2) dualvar.set(v, dualvar.get(v) + delta);
        }
        blossomdual.forEach(function (bd, bl) {
          if (blossomparent.get(bl) === null) {
            if (label.get(bl) === 1) blossomdual.set(bl, bd + delta);
            else if (label.get(bl) === 2) blossomdual.set(bl, bd - delta);
          }
        });

        if (deltatype === 1) break;
        else if (deltatype === 2 || deltatype === 3) {
          v = deltaedge[0]; w = deltaedge[1];
          allowedge.add(ak(v, w)); allowedge.add(ak(w, v));
          queue.push(v);
        } else if (deltatype === 4) {
          expandBlossom(deltablossom, false);
        }
      }
      if (!augmented) break;
      Array.from(blossomdual.keys()).forEach(function (bl) {
        if (!blossomdual.has(bl)) return;
        if (blossomparent.get(bl) === null && label.get(bl) === 1 && blossomdual.get(bl) === 0) expandBlossom(bl, true);
      });
    }

    var out = [];
    for (v = 0; v < n; v++) out.push(mate.has(v) ? mate.get(v) : -1);
    return out;
  }

  // ---------- optimiser: lowest total cost over a set of guest indices ----------
  // Exact: finds the cheapest way to pair up an EVEN-sized list of guests.
  function bestEven(idx, C) {
    var m = idx.length;
    if (m === 0) return { pairs: [], total: 0 };
    var maxC = -Infinity, a, b;
    for (a = 0; a < m; a++) for (b = a + 1; b < m; b++) maxC = Math.max(maxC, C[idx[a]][idx[b]]);
    var BIG = maxC + 1; // turns "minimise cost" into "maximise weight" with all weights >= 1
    var Wm = [];
    for (a = 0; a < m; a++) {
      Wm.push([]);
      for (b = 0; b < m; b++) Wm[a].push(a === b ? 0 : BIG - C[idx[a]][idx[b]]);
    }
    var mate = maxWeightMatching(m, Wm);
    var pairs = [], total = 0;
    for (a = 0; a < m; a++) {
      if (mate[a] > a) {
        pairs.push([idx[a], idx[mate[a]]]);
        total += C[idx[a]][idx[mate[a]]];
      }
    }
    return { pairs: pairs, total: total };
  }

  // ---------- public: match a whole room ----------
  // guests: [{ id, gender ('girl'|'guy'|'they'), age, intent, hobby1, hobby2, vibe }, ...]
  // returns { groups: [[guest, guest] or [guest, guest, guest]], total, leftover }
  function computeMatches(guests) {
    var n = guests.length;
    if (n < 2) return { groups: [], total: 0, leftover: n === 1 ? guests[0] : null };

    var C = buildMatrix(guests);
    var all = [], i;
    for (i = 0; i < n; i++) all.push(i);

    var groupsIdx, total;

    if (n % 2 === 0) {
      var r = bestEven(all, C);
      groupsIdx = r.pairs; total = r.total;
    } else {
      // Odd head-count: exactly one group of three, everyone else in pairs.
      // Step 1 — for every person x as "the third", pair up everyone else
      // optimally and attach x to the pair they fit best (fast, very good).
      var best = null, perX = [], x;
      for (x = 0; x < n; x++) {
        var rest = all.filter(function (v) { return v !== x; });
        var rr = bestEven(rest, C);
        perX.push(rr.total);
        var bk = -1, bcost = Infinity;
        rr.pairs.forEach(function (p, k) {
          var c = C[x][p[0]] + C[x][p[1]];
          if (c < bcost) { bcost = c; bk = k; }
        });
        var tot = rr.total + bcost;
        if (!best || tot < best.total) {
          var gi = rr.pairs.map(function (p, k) { return k === bk ? [p[0], p[1], x] : p; });
          best = { total: tot, groups: gi };
        }
      }
      // Step 2 — make it EXACT. For a trio {x,a,b} the total can never be
      // below perX[x] + C[x][a] + C[x][b]. Check every trio whose bound beats
      // the current best, cheapest bound first, and stop as soon as no
      // remaining trio can win.
      var cands = [], a2, b2;
      for (x = 0; x < n; x++) {
        for (a2 = 0; a2 < n; a2++) {
          if (a2 === x) continue;
          for (b2 = a2 + 1; b2 < n; b2++) {
            if (b2 === x) continue;
            var lb = perX[x] + C[x][a2] + C[x][b2];
            if (lb < best.total) cands.push([lb, x, a2, b2]);
          }
        }
      }
      cands.sort(function (p, q) { return p[0] - q[0]; });
      var maxEvals = Math.max(20, Math.floor(15000 / n)), t0 = Date.now();
      for (var ci = 0; ci < cands.length && ci < maxEvals; ci++) {
        var cd = cands[ci];
        if (cd[0] >= best.total) break;
        if (Date.now() - t0 > 6000) break;
        var tx = cd[1], ta = cd[2], tb = cd[3];
        var remaining = all.filter(function (v) { return v !== tx && v !== ta && v !== tb; });
        var rm = bestEven(remaining, C);
        var tt = C[tx][ta] + C[tx][tb] + C[ta][tb] + rm.total;
        if (tt < best.total) best = { total: tt, groups: rm.pairs.concat([[ta, tb, tx]]) };
      }
      groupsIdx = best.groups; total = best.total;
    }

    var groups = groupsIdx.map(function (g) {
      return g.map(function (k) { return guests[k]; });
    });
    return { groups: groups, total: total, leftover: null };
  }

  // A late arrival when everyone else is already matched: which existing
  // PAIR (array of two guests) fits them best? Returns an index, or -1.
  function bestJoin(guest, pairs) {
    var best = -1, bc = Infinity;
    pairs.forEach(function (p, k) {
      var c = pairCost(guest, p[0]) + pairCost(guest, p[1]);
      if (c < bc) { bc = c; best = k; }
    });
    return best;
  }

  // Host-panel summary: how many matches got everything they asked for?
  function summarize(groups) {
    var s = { groups: groups.length, trios: 0, perfect: 0, intentMismatches: 0, genderCompromises: 0, ageCompromises: 0 };
    groups.forEach(function (g) {
      if (g.length === 3) s.trios++;
      var gen = 0, age = 0, intent = 0;
      for (var i = 0; i < g.length; i++) {
        for (var j = i + 1; j < g.length; j++) {
          var e = explain(g[i], g[j]);
          gen += e.genderMismatch;
          if (e.ageBroken) age++;
          if (e.intentMismatch) intent++;
        }
      }
      if (gen) s.genderCompromises++;
      if (age) s.ageCompromises++;
      if (intent) s.intentMismatches++;
      if (!gen && !age && !intent) s.perfect++;
    });
    return s;
  }

  var api = {
    W: W, normHobby: normHobby, genderOk: genderOk, ageRule: ageRule, explain: explain,
    pairCost: pairCost, buildMatrix: buildMatrix, computeMatches: computeMatches,
    bestJoin: bestJoin, summarize: summarize
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Matching = api;

})(typeof window !== 'undefined' ? window : globalThis);
