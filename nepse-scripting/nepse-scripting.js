/* nepse-scripting.js — ND Script v1: Pine-style custom indicator engine.
   Client-side only, from published bars. The engine is a real parser +
   evaluator: user text is NEVER eval'd, never injected as HTML, and
   never sent anywhere. One script runs on one symbol's daily bars.
   Bars: history/<SYM>.json (full OHLCV+turnover), ltp/<SYM>.json
   (close-only fallback), or /data/index-history.json (NEPSE index).
   Bars are as-published closes, NOT bonus-adjusted. */

(function () {
  var UNI_URL = '/nepse-chart/data/universe.json';
  var MANIFEST_URL = '/nepse-chart/data/manifest.json';
  var HIST_URL = function (s) { return '/nepse-chart/data/history/' + s.replace(/\//g, '-') + '.json'; };
  var LTP_URL = function (s) { return '/nepse-chart/data/ltp/' + s.replace(/\//g, '-') + '.json'; };
  var INDEX_URL = '/data/index-history.json';
  var PLOT_COLORS = ['#2962FF', '#FF6D00', '#4ADE80', '#F5B301', '#8B5CF6', '#00BCD4', '#F87171', '#3080FF'];
  var BUILTINS = ['sma', 'ema', 'rsi', 'macd', 'signal', 'stdev', 'highest', 'lowest', 'crossover', 'crossunder', 'abs', 'min', 'max'];
  var SERIES_NAMES = ['open', 'high', 'low', 'close', 'volume', 'bar_index'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fetchJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function fmtNum(v, dp) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    return Number(v).toFixed(dp === undefined ? 2 : dp);
  }
  function fmtDate(ymd) {
    var s = String(ymd);
    if (s.length === 8) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    return s;
  }
  function ymdToTime(ymd) { return fmtDate(ymd); }

  /* ---------------- tokenizer ---------------- */

  function tokenize(src, startLine) {
    var toks = [], i = 0, line = startLine || 1, n = src.length;
    function err(msg) { throw { line: line, message: msg }; }
    while (i < n) {
      var c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '"') {
        var j = i + 1, out = '';
        while (j < n && src[j] !== '"') {
          if (src[j] === '\\' && j + 1 < n && (src[j + 1] === '"' || src[j + 1] === '\\')) { out += src[j + 1]; j += 2; }
          else { out += src[j]; j++; }
        }
        if (j >= n) err('unterminated string');
        toks.push({ t: 'str', v: out, line: line }); i = j + 1; continue;
      }
      if (c === '#') {
        var m = /^#[0-9a-fA-F]{8}\b|^#[0-9a-fA-F]{6}\b/.exec(src.slice(i));
        if (!m) err('bad color — use #RRGGBB or #RRGGBBAA');
        toks.push({ t: 'color', v: m[0], line: line }); i += m[0].length; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var mm = /^[0-9]*\.?[0-9]+/.exec(src.slice(i));
        toks.push({ t: 'num', v: parseFloat(mm[0]), line: line }); i += mm[0].length; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        var id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))[0];
        toks.push({ t: 'id', v: id, line: line }); i += id.length; continue;
      }
      var two = src.slice(i, i + 2);
      if (two === '==' || two === '!=' || two === '>=' || two === '<=' || two === '&&' || two === '||') {
        toks.push({ t: 'op', v: two, line: line }); i += 2; continue;
      }
      if ('+-*/%()[],?:=<>!'.indexOf(c) >= 0) {
        toks.push({ t: 'op', v: c, line: line }); i++; continue;
      }
      err("unexpected character '" + c + "'");
    }
    toks.push({ t: 'eof', line: line });
    return toks;
  }

  /* ---------------- parser ----------------
     One statement per line. Expressions never span lines. */

  function parse(src) {
    var lines = src.split('\n');
    var stmts = [];
    var seenVersion = false, seenIndicator = false;
    var firstContent = -1;
    for (var li = 0; li < lines.length; li++) {
      var raw = lines[li];
      if (/^\/\/@version=1\s*$/.test(raw.trim())) {
        if (seenVersion) throw { line: li + 1, message: 'duplicate //@version=1 header' };
        seenVersion = true; continue;
      }
      if (/^\/\/@version=/.test(raw.trim())) {
        throw { line: li + 1, message: 'unsupported version — this page runs //@version=1 only' };
      }
      var trimmed = raw.replace(/\/\/.*$/, '').trim();
      if (!trimmed) continue;
      if (firstContent < 0) firstContent = li;
      if (!seenVersion && firstContent === li) {
        throw { line: li + 1, message: 'missing //@version=1 header — put it on the first line' };
      }
      var toks = tokenize(raw, li + 1);
      var p = new Parser(toks, li + 1);
      stmts.push(p.parseStatement());
      if (p.peek().t !== 'eof') throw { line: li + 1, message: "unexpected trailing input '" + p.peek().v + "' — keep each statement on one line" };
    }
    if (!seenVersion) throw { line: 1, message: 'missing //@version=1 header — put it on the first line' };
    // indicator() must appear exactly once, before any plot/hline/bgcolor
    var indIdx = -1, plotIdx = -1;
    for (var k = 0; k < stmts.length; k++) {
      if (stmts[k].t === 'indicator') {
        if (indIdx >= 0) throw { line: stmts[k].line, message: 'indicator() must appear exactly once' };
        indIdx = k;
      }
      if ((stmts[k].t === 'plot' || stmts[k].t === 'hline' || stmts[k].t === 'bgcolor') && plotIdx < 0) plotIdx = k;
    }
    if (indIdx < 0) throw { line: 1, message: 'missing indicator("Title", overlay=...) declaration' };
    if (plotIdx >= 0 && plotIdx < indIdx) throw { line: stmts[plotIdx].line, message: 'indicator() must come before any plot' };
    return stmts;
  }

  function Parser(toks, lineNo) {
    this.toks = toks; this.i = 0; this.line = lineNo;
  }
  Parser.prototype.peek = function () { return this.toks[this.i]; };
  Parser.prototype.next = function () { return this.toks[this.i++]; };
  Parser.prototype.err = function (msg) { throw { line: this.line, message: msg }; };
  Parser.prototype.expectOp = function (v) {
    var t = this.next();
    if (t.t !== 'op' || t.v !== v) this.err("expected '" + v + "' but found '" + (t.v === undefined ? t.t : t.v) + "'");
  };
  Parser.prototype.parseStatement = function () {
    var t = this.peek();
    if (t.t === 'id' && (t.v === 'plot' || t.v === 'hline' || t.v === 'bgcolor' || t.v === 'indicator')) {
      return this.parseCallStatement();
    }
    if (t.t === 'id') {
      var name = this.next().v;
      if (name === 'true' || name === 'false' || name === 'na') this.err("'" + name + "' cannot be assigned");
      var op = this.next();
      if (op.t !== 'op' || op.v !== '=') this.err("expected '=' after '" + name + "'");
      var expr = this.parseExpr();
      return { t: 'assign', name: name, expr: expr, line: this.line };
    }
    this.err("expected a statement but found '" + (t.v === undefined ? t.t : t.v) + "'");
  };
  Parser.prototype.parseCallStatement = function () {
    var name = this.next().v;
    this.expectOp('(');
    var args = [], named = {};
    if (!(this.peek().t === 'op' && this.peek().v === ')')) {
      for (;;) {
        if (this.peek().t === 'id' && this.toks[this.i + 1] && this.toks[this.i + 1].t === 'op' && this.toks[this.i + 1].v === '=') {
          var nk = this.next().v; this.next();
          named[nk] = this.parseExpr();
        } else {
          args.push(this.parseExpr());
        }
        if (this.peek().t === 'op' && this.peek().v === ',') { this.next(); continue; }
        break;
      }
    }
    this.expectOp(')');
    if (name === 'indicator') {
      if (args.length < 1 || args[0].t !== 'str') this.err('indicator() needs a title string, e.g. indicator("My Indicator")');
      var overlay = true;
      if (named.overlay !== undefined) {
        if (named.overlay.t !== 'bool') this.err('overlay must be true or false');
        overlay = named.overlay.v;
      } else if (args.length >= 2) {
        if (args[1].t !== 'bool') this.err('overlay must be true or false');
        overlay = args[1].v;
      }
      var extra = Object.keys(named).filter(function (k) { return k !== 'overlay'; });
      if (extra.length) this.err("unknown indicator option '" + extra[0] + "' — only overlay is supported");
      if (args.length > 2) this.err('indicator() takes a title and an optional overlay flag only');
      return { t: 'indicator', title: args[0].v, overlay: overlay, line: this.line };
    }
    if (name === 'plot') {
      if (args.length < 2) this.err('plot() needs a series and a title, e.g. plot(sma(close, 20), "SMA 20")');
      if (args[1].t !== 'str') this.err('plot() title must be a string');
      var color = null;
      if (named.color !== undefined) {
        if (named.color.t !== 'color') this.err('plot() color must be a #RRGGBB value');
        color = named.color.v;
      } else if (args.length >= 3) {
        if (args[2].t !== 'color') this.err('plot() color must be a #RRGGBB value');
        color = args[2].v;
      }
      if (Object.keys(named).filter(function (k) { return k !== 'color'; }).length) this.err("plot() supports only the 'color' option");
      if (args.length > 3) this.err('plot() takes a series, a title, and an optional color only');
      return { t: 'plot', expr: args[0], title: args[1].v, color: color, line: this.line };
    }
    if (name === 'hline') {
      if (args.length < 2) this.err('hline() needs a level and a title, e.g. hline(70, "Overbought")');
      if (args[0].t !== 'num') this.err('hline() level must be a number, not a series');
      if (args[1].t !== 'str') this.err('hline() title must be a string');
      var hcolor = null;
      if (named.color !== undefined) {
        if (named.color.t !== 'color') this.err('hline() color must be a #RRGGBB value');
        hcolor = named.color.v;
      } else if (args.length >= 3) {
        if (args[2].t !== 'color') this.err('hline() color must be a #RRGGBB value');
        hcolor = args[2].v;
      }
      if (args.length > 3) this.err('hline() takes a level, a title, and an optional color only');
      return { t: 'hline', level: args[0].v, title: args[1].v, color: hcolor, line: this.line };
    }
    if (name === 'bgcolor') {
      if (args.length < 1) this.err('bgcolor() needs a condition, e.g. bgcolor(crossover(a, b))');
      var bcolor = null;
      if (named.color !== undefined) {
        if (named.color.t !== 'color') this.err('bgcolor() color must be a #RRGGBB value');
        bcolor = named.color.v;
      } else if (args.length >= 2) {
        if (args[1].t !== 'color') this.err('bgcolor() color must be a #RRGGBB value');
        bcolor = args[1].v;
      }
      if (args.length > 2) this.err('bgcolor() takes a condition and an optional color only');
      return { t: 'bgcolor', expr: args[0], color: bcolor, line: this.line };
    }
    this.err("unknown statement '" + name + "'");
  };
  Parser.prototype.parseExpr = function () { return this.parseTernary(); };
  Parser.prototype.parseTernary = function () {
    var c = this.parseOr();
    if (this.peek().t === 'op' && this.peek().v === '?') {
      this.next();
      var a = this.parseExpr();
      this.expectOp(':');
      var b = this.parseExpr();
      return { t: 'tern', c: c, a: a, b: b, line: this.line };
    }
    return c;
  };
  Parser.prototype.parseOr = function () {
    var l = this.parseAnd();
    for (;;) {
      var t = this.peek();
      if ((t.t === 'id' && t.v === 'or') || (t.t === 'op' && t.v === '||')) {
        this.next(); l = { t: 'bin', op: 'or', l: l, r: this.parseAnd(), line: this.line };
      } else return l;
    }
  };
  Parser.prototype.parseAnd = function () {
    var l = this.parseCmp();
    for (;;) {
      var t = this.peek();
      if ((t.t === 'id' && t.v === 'and') || (t.t === 'op' && t.v === '&&')) {
        this.next(); l = { t: 'bin', op: 'and', l: l, r: this.parseCmp(), line: this.line };
      } else return l;
    }
  };
  Parser.prototype.parseCmp = function () {
    var l = this.parseAdd();
    var t = this.peek();
    if (t.t === 'op' && (t.v === '>' || t.v === '<' || t.v === '>=' || t.v === '<=' || t.v === '==' || t.v === '!=')) {
      this.next(); l = { t: 'bin', op: t.v, l: l, r: this.parseAdd(), line: this.line };
    }
    return l;
  };
  Parser.prototype.parseAdd = function () {
    var l = this.parseMul();
    for (;;) {
      var t = this.peek();
      if (t.t === 'op' && (t.v === '+' || t.v === '-')) {
        this.next(); l = { t: 'bin', op: t.v, l: l, r: this.parseMul(), line: this.line };
      } else return l;
    }
  };
  Parser.prototype.parseMul = function () {
    var l = this.parseUnary();
    for (;;) {
      var t = this.peek();
      if (t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        this.next(); l = { t: 'bin', op: t.v, l: l, r: this.parseUnary(), line: this.line };
      } else return l;
    }
  };
  Parser.prototype.parseUnary = function () {
    var t = this.peek();
    if ((t.t === 'op' && t.v === '-') || (t.t === 'id' && t.v === 'not') || (t.t === 'op' && t.v === '!')) {
      this.next();
      var op = (t.v === 'not' || t.v === '!') ? 'not' : '-';
      return { t: 'un', op: op, x: this.parseUnary(), line: this.line };
    }
    return this.parsePostfix();
  };
  Parser.prototype.parsePostfix = function () {
    var e = this.parsePrimary();
    if (this.peek().t === 'op' && this.peek().v === '[') {
      this.next();
      var nt = this.next();
      if (nt.t !== 'num' || nt.v < 0 || Math.floor(nt.v) !== nt.v) this.err('history offset must be a non-negative integer, e.g. close[1]');
      this.expectOp(']');
      return { t: 'hist', x: e, n: nt.v, line: this.line };
    }
    return e;
  };
  Parser.prototype.parsePrimary = function () {
    var t = this.next();
    if (t.t === 'num') return { t: 'num', v: t.v, line: this.line };
    if (t.t === 'str') return { t: 'str', v: t.v, line: this.line };
    if (t.t === 'color') return { t: 'color', v: t.v, line: this.line };
    if (t.t === 'id' && t.v === 'true') return { t: 'bool', v: true, line: this.line };
    if (t.t === 'id' && t.v === 'false') return { t: 'bool', v: false, line: this.line };
    if (t.t === 'id' && t.v === 'na') return { t: 'na', line: this.line };
    if (t.t === 'op' && t.v === '(') {
      var e = this.parseExpr();
      this.expectOp(')');
      return e;
    }
    if (t.t === 'id') {
      if (this.peek().t === 'op' && this.peek().v === '(') {
        this.next();
        var args = [];
        if (!(this.peek().t === 'op' && this.peek().v === ')')) {
          for (;;) {
            args.push(this.parseExpr());
            if (this.peek().t === 'op' && this.peek().v === ',') { this.next(); continue; }
            break;
          }
        }
        this.expectOp(')');
        return { t: 'call', name: t.v, args: args, line: this.line };
      }
      return { t: 'var', name: t.v, line: this.line };
    }
    this.err("expected a value but found '" + (t.v === undefined ? t.t : t.v) + "'");
  };

  /* ---------------- evaluator ----------------
     A value is either a scalar (number/boolean) or an array of
     numbers/booleans/null, one per bar. null propagates: any null
     operand makes that bar null, except and/or which use three-valued
     logic (false and na = false, true or na = true). */

  function isArr(v) { return Array.isArray(v); }
  function toArr(v, n) { return isArr(v) ? v : Array.apply(null, Array(n)).map(function () { return v; }); }
  function isNull(x) { return x === null || x === undefined; }

  function elemWise(op, a, b, n, line) {
    var A = toArr(a, n), B = toArr(b, n), out = new Array(n);
    for (var i = 0; i < n; i++) {
      var x = A[i], y = B[i];
      if (op === 'and') {
        if (x === false || y === false) out[i] = false;
        else if (isNull(x) || isNull(y)) out[i] = null;
        else out[i] = !!(x && y);
      } else if (op === 'or') {
        if (x === true || y === true) out[i] = true;
        else if (isNull(x) || isNull(y)) out[i] = null;
        else out[i] = !!(x || y);
      } else if (isNull(x) || isNull(y)) {
        out[i] = null;
      } else if (op === '+') out[i] = x + y;
      else if (op === '-') out[i] = x - y;
      else if (op === '*') out[i] = x * y;
      else if (op === '/') out[i] = (y === 0) ? null : x / y;
      else if (op === '%') out[i] = (y === 0) ? null : x % y;
      else if (op === '>') out[i] = x > y;
      else if (op === '<') out[i] = x < y;
      else if (op === '>=') out[i] = x >= y;
      else if (op === '<=') out[i] = x <= y;
      else if (op === '==') out[i] = x === y;
      else if (op === '!=') out[i] = x !== y;
      else throw { line: line, message: "unknown operator '" + op + "'" };
    }
    return out;
  }

  function numSeries(v, what, line) {
    if (isArr(v)) {
      for (var i = 0; i < v.length; i++) {
        if (!isNull(v[i]) && typeof v[i] !== 'number') throw { line: line, message: what + ' expects a numeric series' };
      }
      return v;
    }
    if (typeof v !== 'number') throw { line: line, message: what + ' expects a numeric series' };
    return v;
  }
  function boolSeries(v, what, line) {
    if (isArr(v)) {
      for (var i = 0; i < v.length; i++) {
        if (!isNull(v[i]) && typeof v[i] !== 'boolean') throw { line: line, message: what + ' expects a condition (true/false series)' };
      }
      return v;
    }
    if (typeof v !== 'boolean') throw { line: line, message: what + ' expects a condition (true/false series)' };
    return v;
  }
  function constLength(v, fn, line) {
    var val;
    if (isArr(v)) {
      for (var i = 0; i < v.length; i++) {
        if (isNull(v[i])) throw { line: line, message: fn + '() length must be a positive integer, not na' };
        if (val === undefined) val = v[i];
        else if (v[i] !== val) throw { line: line, message: fn + '() length must be constant across bars' };
      }
      if (val === undefined) throw { line: line, message: fn + '() length must be a positive integer' };
    } else val = v;
    if (typeof val !== 'number' || Math.floor(val) !== val || val <= 0) {
      throw { line: line, message: fn + '() length must be a positive integer (got ' + val + ')' };
    }
    return val;
  }
  function windowed(vals, n, f, line, nBars) {
    var A = toArr(numSeries(vals, 'series function', line), nBars);
    var out = new Array(A.length);
    for (var i = 0; i < A.length; i++) {
      if (i < n - 1) { out[i] = null; continue; }
      var win = A.slice(i - n + 1, i + 1), bad = false;
      for (var j = 0; j < win.length; j++) if (isNull(win[j])) { bad = true; break; }
      out[i] = bad ? null : f(win);
    }
    return out;
  }
  function smaFn(vals, n, line) {
    return windowed(vals, n, function (w) {
      var s = 0; for (var i = 0; i < w.length; i++) s += w[i]; return s / w.length;
    }, line);
  }
  function emaFn(vals, n, line, nBars) {
    var A = toArr(numSeries(vals, 'ema()', line), nBars);
    var k = 2 / (n + 1), prev = null, out = new Array(A.length);
    for (var i = 0; i < A.length; i++) {
      if (isNull(A[i])) { out[i] = null; continue; }
      prev = (prev === null) ? A[i] : A[i] * k + prev * (1 - k);
      out[i] = (i >= n - 1) ? prev : null;
    }
    return out;
  }
  function rsiFrom(avgG, avgL) {
    if (avgL === 0) return (avgG === 0) ? 50 : 100;
    return 100 - 100 / (1 + avgG / avgL);
  }
  function rsiFn(vals, n, line, nBars) {
    var A = toArr(numSeries(vals, 'rsi()', line), nBars);
    var out = new Array(A.length);
    if (A.length) out[0] = null;
    var bufG = [], bufL = [], avgG = null, avgL = null, seeded = false;
    for (var i = 1; i < A.length; i++) {
      var c = (isNull(A[i]) || isNull(A[i - 1])) ? null : A[i] - A[i - 1];
      if (c === null) {
        if (!seeded) { bufG = []; bufL = []; }
        out[i] = null; continue;
      }
      if (!seeded) {
        bufG.push(c > 0 ? c : 0); bufL.push(c < 0 ? -c : 0);
        if (bufG.length === n) {
          var sg = 0, sl = 0;
          for (var j = 0; j < n; j++) { sg += bufG[j]; sl += bufL[j]; }
          avgG = sg / n; avgL = sl / n; seeded = true;
          out[i] = rsiFrom(avgG, avgL);
        } else out[i] = null;
      } else {
        avgG = (avgG * (n - 1) + (c > 0 ? c : 0)) / n;
        avgL = (avgL * (n - 1) + (c < 0 ? -c : 0)) / n;
        out[i] = rsiFrom(avgG, avgL);
      }
    }
    return out;
  }
  function stdevFn(vals, n, line, nBars) {
    return windowed(vals, n, function (w) {
      var m = 0, i;
      for (i = 0; i < w.length; i++) m += w[i];
      m /= w.length;
      var ss = 0;
      for (i = 0; i < w.length; i++) ss += (w[i] - m) * (w[i] - m);
      return Math.sqrt(ss / w.length);
    }, line, nBars);
  }
  function crossFn(a, b, n, up, line) {
    var A = toArr(a, n), B = toArr(b, n), out = new Array(n);
    if (n) out[0] = false;
    for (var i = 1; i < n; i++) {
      if (isNull(A[i - 1]) || isNull(B[i - 1]) || isNull(A[i]) || isNull(B[i])) { out[i] = false; continue; }
      out[i] = up ? (A[i - 1] <= B[i - 1] && A[i] > B[i]) : (A[i - 1] >= B[i - 1] && A[i] < B[i]);
    }
    return out;
  }

  var ARITY = { sma: 2, ema: 2, rsi: 2, macd: 3, signal: 2, stdev: 2, highest: 2, lowest: 2, crossover: 2, crossunder: 2, abs: 1, min: 2, max: 2 };

  function evalExpr(node, env, bars, n) {
    switch (node.t) {
      case 'num': case 'bool': return node.v;
      case 'str': throw { line: node.line, message: 'a string cannot be used as a number' };
      case 'color': throw { line: node.line, message: 'a color cannot be used as a number' };
      case 'na': return null;
      case 'var': {
        if (env.hasOwnProperty(node.name)) return env[node.name];
        throw { line: node.line, message: "unknown name '" + node.name + "' — define it before use (series: open, high, low, close, volume, bar_index)" };
      }
      case 'hist': {
        var v = evalExpr(node.x, env, bars, n);
        var A = toArr(v, n), out = new Array(n);
        for (var i = 0; i < n; i++) out[i] = (i >= node.n) ? A[i - node.n] : null;
        return out;
      }
      case 'un': {
        var x = evalExpr(node.x, env, bars, n);
        if (node.op === '-') {
          if (isArr(x)) return x.map(function (v) { return isNull(v) ? null : -v; });
          if (typeof x !== 'number') throw { line: node.line, message: 'unary - needs a number' };
          return -x;
        }
        if (isArr(x)) return x.map(function (v) { return isNull(v) ? null : !v; });
        if (typeof x !== 'boolean') throw { line: node.line, message: 'not needs a true/false value' };
        return !x;
      }
      case 'bin': {
        var l = evalExpr(node.l, env, bars, n), r = evalExpr(node.r, env, bars, n);
        return elemWise(node.op, l, r, n, node.line);
      }
      case 'tern': {
        var c = evalExpr(node.c, env, bars, n);
        var a = evalExpr(node.a, env, bars, n), b = evalExpr(node.b, env, bars, n);
        if (!isArr(c) && !isArr(a) && !isArr(b)) {
          if (isNull(c)) return null;
          return c ? a : b;
        }
        var C = toArr(c, n), A2 = toArr(a, n), B2 = toArr(b, n), out = new Array(n);
        for (var i = 0; i < n; i++) out[i] = isNull(C[i]) ? null : (C[i] ? A2[i] : B2[i]);
        return out;
      }
      case 'call': return evalCall(node, env, bars, n);
      default: throw { line: node.line, message: 'unsupported expression' };
    }
  }

  function evalCall(node, env, bars, n) {
    var name = node.name;
    if (BUILTINS.indexOf(name) < 0) {
      throw { line: node.line, message: "unknown function '" + name + "' — available: " + BUILTINS.join(', ') };
    }
    if (node.args.length !== ARITY[name]) {
      throw { line: node.line, message: name + '() takes ' + ARITY[name] + ' argument(s), got ' + node.args.length };
    }
    var ev = node.args.map(function (a) { return evalExpr(a, env, bars, n); });
    function src(i) { return numSeries(ev[i], name + '()', node.line); }
    function len(i) { return constLength(ev[i], name, node.line); }
    switch (name) {
      case 'sma': return smaFn(src(0), len(1), node.line, n);
      case 'ema': return emaFn(src(0), len(1), node.line, n);
      case 'rsi': return rsiFn(src(0), len(1), node.line, n);
      case 'macd': {
        var f = emaFn(src(0), len(1), node.line, n);
        var s = emaFn(src(0), len(2), node.line, n);
        return elemWise('-', f, s, n, node.line);
      }
      case 'signal': return emaFn(src(0), len(1), node.line, n);
      case 'stdev': return stdevFn(src(0), len(1), node.line, n);
      case 'highest': return windowed(src(0), len(1), function (w) { return Math.max.apply(null, w); }, node.line, n);
      case 'lowest': return windowed(src(0), len(1), function (w) { return Math.min.apply(null, w); }, node.line, n);
      case 'crossover': return crossFn(src(0), src(1), n, true, node.line);
      case 'crossunder': return crossFn(src(0), src(1), n, false, node.line);
      case 'abs': {
        var v = src(0);
        if (isArr(v)) return v.map(function (x) { return isNull(x) ? null : Math.abs(x); });
        return Math.abs(v);
      }
      case 'min': case 'max': {
        var A = toArr(src(0), n), B = toArr(src(1), n), out = new Array(n);
        for (var i = 0; i < n; i++) {
          if (isNull(A[i]) || isNull(B[i])) out[i] = null;
          else out[i] = (name === 'min') ? Math.min(A[i], B[i]) : Math.max(A[i], B[i]);
        }
        return out;
      }
      default: throw { line: node.line, message: "unimplemented built-in '" + name + "'" };
    }
  }

  function runScript(text, bars) {
    var n = bars.length;
    var env = {};
    env.open = bars.map(function (b) { return b.open; });
    env.high = bars.map(function (b) { return b.high; });
    env.low = bars.map(function (b) { return b.low; });
    env.close = bars.map(function (b) { return b.close; });
    env.volume = bars.map(function (b) { return b.volume; });
    env.bar_index = bars.map(function (_, i) { return i; });
    var stmts;
    try {
      stmts = parse(text);
    } catch (e) {
      return { ok: false, errors: [{ line: e.line || 1, message: e.message || String(e) }] };
    }
    var title = '', overlay = true, plots = [], hlines = [], bgcolors = [];
    var defined = {};
    SERIES_NAMES.forEach(function (s) { defined[s] = true; });
    BUILTINS.forEach(function (b) { defined[b] = true; });
    ['plot', 'hline', 'bgcolor', 'indicator'].forEach(function (b) { defined[b] = true; });
    try {
      for (var si = 0; si < stmts.length; si++) {
        var st = stmts[si];
        if (st.t === 'indicator') { title = st.title; overlay = st.overlay; continue; }
        if (st.t === 'assign') {
          if (defined[st.name]) throw { line: st.line, message: "'" + st.name + "' cannot be redefined — use a new name" };
          defined[st.name] = true;
          env[st.name] = evalExpr(st.expr, env, bars, n);
          continue;
        }
        if (st.t === 'plot') {
          if (plots.length >= 8) throw { line: st.line, message: 'at most 8 plots per script' };
          var pv = evalExpr(st.expr, env, bars, n);
          numSeries(pv, 'plot()', st.line);
          plots.push({ title: st.title, color: st.color || PLOT_COLORS[plots.length % PLOT_COLORS.length], values: pv });
          continue;
        }
        if (st.t === 'hline') {
          if (hlines.length >= 8) throw { line: st.line, message: 'at most 8 hlines per script' };
          hlines.push({ level: st.level, title: st.title, color: st.color || '#9AA3B2' });
          continue;
        }
        if (st.t === 'bgcolor') {
          if (bgcolors.length >= 4) throw { line: st.line, message: 'at most 4 bgcolor() calls per script' };
          var cv = evalExpr(st.expr, env, bars, n);
          boolSeries(cv, 'bgcolor()', st.line);
          bgcolors.push({ color: st.color || '#4ADE8033', values: cv });
          continue;
        }
      }
      if (!plots.length) throw { line: 1, message: 'no plots — add at least one plot(...) call' };
    } catch (e) {
      return { ok: false, errors: [{ line: e.line || 1, message: e.message || String(e) }] };
    }
    return { ok: true, title: title, overlay: overlay, plots: plots, hlines: hlines, bgcolors: bgcolors };
  }

  /* expose the engine for the page UI and for proof harnesses */
  window.NDScript = { run: runScript, builtins: BUILTINS.slice() };

  /* ---------------- page UI ---------------- */

  var S = {
    uni: {}, uniList: [], sym: 'NABIL', symName: '', kind: 'full',
    bars: [], dates: [], updated: '', lastSession: '', manifestSession: '',
    out: null, charts: [], note: ''
  };
  var EXAMPLES = {
    cross: '//@version=1\nindicator("SMA Crossover", overlay=true)\ns20 = sma(close, 20)\ns50 = sma(close, 50)\nplot(s20, "SMA 20", #2962FF)\nplot(s50, "SMA 50", #FF6D00)\nbgcolor(crossover(s20, s50), #4ADE8033)\nbgcolor(crossunder(s20, s50), #F8717133)',
    rsi: '//@version=1\nindicator("RSI 14", overlay=false)\nr = rsi(close, 14)\nplot(r, "RSI", #8B5CF6)\nhline(70, "Overbought", #F87171)\nhline(30, "Oversold", #4ADE80)',
    bb: '//@version=1\nindicator("Bollinger Bands", overlay=true)\nbasis = sma(close, 20)\ndev = stdev(close, 20)\nupper = basis + 2 * dev\nlower = basis - 2 * dev\nplot(basis, "Basis", #2962FF)\nplot(upper, "Upper", #FF6D00)\nplot(lower, "Lower", #FF6D00)',
    macd: '//@version=1\nindicator("MACD 12 26 9", overlay=false)\nm = macd(close, 12, 26)\ns = signal(m, 9)\nplot(m, "MACD", #2962FF)\nplot(s, "Signal", #FF6D00)\nhline(0, "Zero", #9AA3B2)'
  };

  function isDark() {
    var h = document.documentElement;
    var v = h.getAttribute('data-nd-ed') || h.getAttribute('data-theme') || 'dark';
    return v !== 'light';
  }
  function themePalette() {
    if (isDark()) return {
      bg: '#12141A', text: '#B8C0CE', grid: '#1E2430', up: '#4ADE80', down: '#F87171',
      line: '#B8E62E', cross: '#B8C0CE'
    };
    return {
      bg: '#FFFFFF', text: '#4B5563', grid: '#E2E6EC', up: '#15803D', down: '#DC2626',
      line: '#4D7C0F', cross: '#4B5563'
    };
  }
  function lastVal(values) {
    for (var i = values.length - 1; i >= 0; i--) {
      if (!isNull(values[i])) return { v: values[i], i: i };
    }
    return null;
  }
  function showErr(errors) {
    var box = $('scErr');
    if (!errors || !errors.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<strong>Script did not run.</strong><ul>' + errors.map(function (e) {
      return '<li>Line ' + esc(e.line) + ': ' + esc(e.message) + '</li>';
    }).join('') + '</ul>';
  }
  function setFreshline() {
    var fl = $('scFreshline');
    if (!fl) return;
    var last = S.dates.length ? S.dates[S.dates.length - 1] : '';
    var kindNote = S.kind === 'full' ? 'full OHLC bars' : (S.kind === 'ltp' ? 'close-only bars (open/high/low not published)' : 'index bars (open not published on recent sessions)');
    fl.textContent = 'Bars through ' + fmtDate(last) + ' · ' + kindNote + ' · source: site history archive' +
      (S.updated ? ' (updated ' + S.updated + ')' : '') + ' · daily bars only; the live session is not included.';
    var chip = $('scStateChip');
    if (chip) { chip.className = 'sc-chip closed'; chip.innerHTML = '<span class="dot"></span>CLOSED SESSION DATA'; }
  }
  function destroyCharts() {
    S.charts.forEach(function (c) { try { c.remove(); } catch (e) {} });
    S.charts = [];
    $('scPriceChart').innerHTML = '';
    $('scIndChart').innerHTML = '';
    $('scIndWrap').hidden = true;
  }
  function renderOutputs() {
    var out = S.out, el = $('scOutputs');
    if (!out || !out.ok) { el.innerHTML = ''; $('scLegend').innerHTML = ''; return; }
    var rows = out.plots.map(function (p) {
      var lv = lastVal(isArr(p.values) ? p.values : [p.values]);
      return '<tr><td><i class="sc-swatch" style="background:' + esc(p.color) + '"></i>' + esc(p.title) + '</td><td>' +
        (lv ? fmtNum(lv.v) + ' <span class="sc-dim">on ' + fmtDate(S.dates[lv.i]) + '</span>' : '– no values –') + '</td></tr>';
    }).join('');
    out.hlines.forEach(function (h) {
      rows += '<tr><td><i class="sc-swatch" style="background:' + esc(h.color) + '"></i>' + esc(h.title) + ' (line)</td><td>' + fmtNum(h.level) + '</td></tr>';
    });
    out.bgcolors.forEach(function (b, bi) {
      var cnt = 0, lastI = -1;
      var arr = isArr(b.values) ? b.values : [];
      for (var i = 0; i < arr.length; i++) if (arr[i] === true) { cnt++; lastI = i; }
      rows += '<tr><td><i class="sc-swatch" style="background:' + esc(b.color) + '"></i>Highlighted bars #' + (bi + 1) + '</td><td>' + cnt + ' bars' +
        (lastI >= 0 ? ' <span class="sc-dim">last ' + fmtDate(S.dates[lastI]) + '</span>' : '') + '</td></tr>';
    });
    el.innerHTML = '<table class="sc-table"><thead><tr><th>Output</th><th>Last value</th></tr></thead><tbody>' + rows + '</tbody></table>';
    $('scLegend').innerHTML = out.plots.map(function (p) {
      var lv = lastVal(isArr(p.values) ? p.values : [p.values]);
      return '<span class="sc-leg"><i class="sc-swatch" style="background:' + esc(p.color) + '"></i>' + esc(p.title) + ' <b>' + (lv ? fmtNum(lv.v) : '–') + '</b></span>';
    }).join('');
  }
  function drawCharts() {
    destroyCharts();
    var out = S.out;
    if (!out || !out.ok || !window.LightweightCharts) return;
    var pal = themePalette();
    var bars = S.bars;
    var priceEl = $('scPriceChart');
    var priceChart = window.LightweightCharts.createChart(priceEl, {
      width: priceEl.clientWidth || 800, height: 420,
      layout: { background: { color: pal.bg }, textColor: pal.text },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      crosshair: { vertLine: { color: pal.cross }, horzLine: { color: pal.cross } },
      timeScale: { timeVisible: false }
    });
    priceChart._holder = priceEl;
    S.charts.push(priceChart);
    var hasVolume = bars.some(function (b) { return b.volume > 0; });
    if (S.kind === 'full') {
      var candles = priceChart.addCandlestickSeries({ upColor: pal.up, downColor: pal.down, wickUpColor: pal.up, wickDownColor: pal.down, borderVisible: false });
      candles.setData(bars.map(function (b) {
        return { time: ymdToTime(b.date), open: b.open, high: b.high, low: b.low, close: b.close };
      }));
      priceChart.priceScale('').applyOptions({ scaleMargins: { top: 0.05, bottom: hasVolume ? 0.2 : 0.05 } });
      if (hasVolume) {
        var vol = priceChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
        vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        vol.setData(bars.map(function (b) {
          return { time: ymdToTime(b.date), value: b.volume || 0, color: (b.close >= b.open) ? pal.up + '88' : pal.down + '88' };
        }));
      }
    } else {
      var line = priceChart.addLineSeries({ color: pal.line, lineWidth: 2, lastValueVisible: true, priceLineVisible: false });
      line.setData(bars.map(function (b) { return { time: ymdToTime(b.date), value: b.close }; }));
    }
    var bgTarget = null;
    if (out.overlay) {
      out.plots.forEach(function (p) {
        var s = priceChart.addLineSeries({ color: p.color, lineWidth: 2, lastValueVisible: true, priceLineVisible: false });
        var arr = isArr(p.values) ? p.values : [];
        s.setData(arr.map(function (v, i) { return { time: ymdToTime(bars[i].date), value: v }; }).filter(function (d) { return d.value !== null && d.value !== undefined; }));
        if (!bgTarget) bgTarget = s;
      });
      out.hlines.forEach(function (h) {
        if (bgTarget) bgTarget.createPriceLine({ price: h.level, color: h.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: h.title });
      });
    }
    if (out.bgcolors.length) {
      out.bgcolors.forEach(function (bc) {
        var bg = priceChart.addHistogramSeries({ priceFormat: { type: 'price', precision: 0 }, priceScaleId: 'bg', lastValueVisible: false, priceLineVisible: false });
        bg.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 } });
        var arr = isArr(bc.values) ? bc.values : [];
        bg.setData(arr.map(function (v, i) { return { time: ymdToTime(bars[i].date), value: v === true ? 1 : 0, color: bc.color }; }));
      });
    }
    if (!out.overlay) {
      $('scIndWrap').hidden = false;
      var indEl = $('scIndChart');
      var indChart = window.LightweightCharts.createChart(indEl, {
        width: indEl.clientWidth || 800, height: 240,
        layout: { background: { color: pal.bg }, textColor: pal.text },
        grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
        crosshair: { vertLine: { color: pal.cross }, horzLine: { color: pal.cross } },
        timeScale: { timeVisible: false }
      });
      indChart._holder = indEl;
      S.charts.push(indChart);
      var first = null;
      out.plots.forEach(function (p) {
        var s = indChart.addLineSeries({ color: p.color, lineWidth: 2, lastValueVisible: true, priceLineVisible: false });
        var arr = isArr(p.values) ? p.values : [];
        s.setData(arr.map(function (v, i) { return { time: ymdToTime(bars[i].date), value: v }; }).filter(function (d) { return d.value !== null && d.value !== undefined; }));
        if (!first) first = s;
      });
      out.hlines.forEach(function (h) {
        if (first) first.createPriceLine({ price: h.level, color: h.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: h.title });
      });
      priceChart.timeScale().subscribeVisibleLogicalRangeChange(function (r) {
        if (r) indChart.timeScale().setVisibleLogicalRange(r);
      });
    }
    var showFrom = Math.max(0, bars.length - 250);
    priceChart.timeScale().setVisibleLogicalRange({ from: showFrom, to: bars.length - 1 });
    renderOutputs();
  }
  function runCurrent() {
    var err = $('scErr2');
    if (err) err.textContent = '';
    var text = $('scEditor').value;
    if (!S.bars.length) { showErr([{ line: 1, message: 'no bars loaded — pick a symbol first' }]); return; }
    var out = window.NDScript.run(text, S.bars);
    S.out = out;
    if (!out.ok) { destroyCharts(); $('scLegend').innerHTML = ''; $('scOutputs').innerHTML = ''; showErr(out.errors); return; }
    showErr(null);
    $('scTitle').textContent = out.title;
    drawCharts();
    if (S.note && err) { err.textContent = S.note; S.note = ''; }
  }
  function normalizeBars(kind, raw) {
    if (kind === 'index') {
      return raw.rows.map(function (r) {
        return { date: r[0], open: r[1] === 0 ? null : r[1], high: r[2], low: r[3], close: r[4], volume: 0 };
      }).filter(function (b) { return b.close > 0; });
    }
    if (kind === 'ltp') {
      var rows = (typeof raw.rows === 'string') ? JSON.parse(raw.rows) : raw.rows;
      return rows.map(function (r) {
        return { date: r[0], open: null, high: null, low: null, close: r[1], volume: r[2] || 0 };
      }).filter(function (b) { return b.close > 0; });
    }
    return raw.data.map(function (r) {
      return { date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] || 0 };
    }).filter(function (b) { return b.close > 0; });
  }
  function loadSymbol(sym, thenRun) {
    var err = $('scErr2');
    var jobs;
    if (sym === 'NEPSE') {
      jobs = fetchJSON(INDEX_URL).then(function (j) {
        return { kind: 'index', bars: normalizeBars('index', j), updated: j.to || '', name: 'NEPSE Index' };
      });
    } else {
      jobs = fetchJSON(HIST_URL(sym)).then(function (j) {
        return { kind: 'full', bars: normalizeBars('full', j), updated: j.updated || '', name: S.uni[sym] || sym };
      }).catch(function () {
        return fetchJSON(LTP_URL(sym)).then(function (j) {
          return { kind: 'ltp', bars: normalizeBars('ltp', j), updated: '', name: S.uni[sym] || sym };
        });
      });
    }
    jobs.then(function (res) {
      res.bars.sort(function (a, b) { return a.date - b.date; });
      S.sym = sym; S.symName = res.name; S.kind = res.kind; S.bars = res.bars;
      S.dates = res.bars.map(function (b) { return b.date; });
      S.updated = res.updated; S.lastSession = S.dates.length ? S.dates[S.dates.length - 1] : '';
      $('scSymName').textContent = sym + ' — ' + res.name + ' (' + res.bars.length + ' bars)';
      setFreshline();
      if (thenRun) runCurrent();
      try {
        var url = window.location.pathname + '?s=' + encodeURIComponent(sym);
        window.history.replaceState(null, '', url);
      } catch (e) {}
    }).catch(function () {
      S.bars = []; S.dates = [];
      $('scSymName').textContent = sym + ' — no bars on file';
      if (err) err.textContent = 'No history on file for ' + sym + '. Pick another symbol.';
      destroyCharts(); $('scLegend').innerHTML = ''; $('scOutputs').innerHTML = '';
    });
  }
  function applyTheme() {
    if (!S.charts.length || !S.out || !S.out.ok) return;
    drawCharts();
  }
  function tick() {
    fetchJSON(MANIFEST_URL).then(function (m) {
      S.manifestSession = m.session_date || '';
      var note = $('scNewNote');
      if (note) {
        var ms = String(S.manifestSession).replace(/-/g, '');
        var ls = String(S.lastSession).replace(/-/g, '');
        if (ms && ls && ms > ls) {
          note.hidden = false;
          note.textContent = 'New session ' + S.manifestSession + ' is published — Run again to include it. Your current view is unchanged.';
        } else note.hidden = true;
      }
      setFreshline();
    }).catch(function () {});
  }
  function boot() {
    var ed = $('scEditor');
    ed.value = EXAMPLES.cross;
    var params = {};
    try {
      window.location.search.replace(/[?&]([^=&#]+)=([^&#]*)/g, function (_, k, v) { params[decodeURIComponent(k)] = decodeURIComponent(v); });
    } catch (e) {}
    var hash = '';
    try { hash = window.location.hash || ''; } catch (e) {}
    if (hash.indexOf('#script=') === 0) {
      try { ed.value = decodeURIComponent(hash.slice(8)); } catch (e) {}
    }
    fetchJSON(UNI_URL).then(function (u) {
      var list = $('scSymList');
      var opts = ['<option value="NEPSE">'];
      (u.symbols || []).forEach(function (s) {
        S.uni[s.s] = s.n;
        opts.push('<option value="' + esc(s.s) + '">');
      });
      list.innerHTML = opts.join('');
      S.uniList = (u.symbols || []).map(function (s) { return s.s; });
      var sym = (params.s || 'NABIL').toUpperCase();
      if (sym !== 'NEPSE' && !S.uni[sym]) {
        S.note = 'Unknown symbol "' + sym + '" — showing NABIL instead.';
        sym = 'NABIL';
      }
      $('scSym').value = sym;
      loadSymbol(sym, true);
    }).catch(function () {
      $('scErr2').textContent = 'Could not load the symbol list. Reload the page to try again.';
    });
    $('scRun').addEventListener('click', function () {
      var sym = ($('scSym').value || '').trim().toUpperCase();
      if (!sym) { $('scErr2').textContent = 'Pick a symbol first.'; return; }
      if (sym !== 'NEPSE' && S.uniList.length && S.uniList.indexOf(sym) < 0) {
        $('scErr2').textContent = 'Unknown symbol "' + sym + '". Pick one from the list.';
        return;
      }
      if (sym !== S.sym) loadSymbol(sym, true);
      else runCurrent();
    });
    $('scSym').addEventListener('change', function () { $('scRun').click(); });
    document.querySelectorAll('[data-example]').forEach(function (b) {
      b.addEventListener('click', function () {
        ed.value = EXAMPLES[b.getAttribute('data-example')] || EXAMPLES.cross;
        $('scRun').click();
      });
    });
    ed.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('scRun').click(); }
    });
    $('scCopy').addEventListener('click', function () {
      var script = ed.value || '';
      var sym = ($('scSym').value || S.sym || 'NABIL').trim().toUpperCase();
      if (script.length > 4000) { $('scErr2').textContent = 'Script is too long for a share link (over 4000 characters). Shorten it first.'; return; }
      var url = window.location.origin + window.location.pathname + '?s=' + encodeURIComponent(sym) + '#script=' + encodeURIComponent(script);
      function done(ok) { $('scCopy').textContent = ok ? 'Link copied' : 'Copy failed — select the link manually'; setTimeout(function () { $('scCopy').textContent = 'Copy share link'; }, 2500); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done(true); }).catch(function () { done(false); });
      } else done(false);
    });
    setInterval(tick, 60000);
    setTimeout(tick, 5000);
    try {
      var mo = new MutationObserver(function () { applyTheme(); });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-nd-ed'] });
    } catch (e) {}
    window.addEventListener('resize', function () {
      S.charts.forEach(function (ch) {
        try {
          if (ch._holder) ch.applyOptions({ width: ch._holder.clientWidth || 800 });
        } catch (e) {}
      });
    });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
